import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine, MemoryStorage } from '@lostgradient/weft';
import { eq } from '@tribunal/database/operators';
import type { GithubServiceContext } from '@tribunal/github/context';
import type { Database } from '@tribunal/database';
import {
  agent,
  agentEvent,
  agentRun,
  finding,
  githubInstallation,
  githubInstallationRepository,
  pullRequestState,
  repository,
  repositoryAgent,
  repositoryReviewSettings,
  reviewIntent,
  reviewRun,
  userReviewSettings,
} from '@tribunal/database/schema';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, resetIdCounter } from '@tribunal/test/factories';

const createCheckRunMock = vi.fn();
const updateCheckRunMock = vi.fn();
const getDiffContextMock = vi.fn();
const getInstallationOctokitMock = vi.fn();
const getPullRequestMetadataMock = vi.fn();
const mintReadTokenMock = vi.fn();
const findPostedReviewMock = vi.fn();
const postReviewMock = vi.fn();
const createCacheMock = vi.fn((getRedisUrl: () => string | undefined) => {
  getRedisUrl();
  return cacheMock;
});
const cacheMock = {
  getCached: vi.fn(),
  setCache: vi.fn(),
  setCacheIndefinitely: vi.fn(),
  deleteCache: vi.fn(),
  deleteCacheByPattern: vi.fn(),
  resetCacheClient: vi.fn(),
};

class MockSandbox {
  static create = vi.fn();
  static connect = vi.fn();

  readonly sandboxId: string;
  readonly name: string | null = null;
  run = vi.fn();
  startProcess = vi.fn();
  followOutput = vi.fn();
  getProcess = vi.fn();
  killProcess = vi.fn();
  suspend = vi.fn();
  terminate = vi.fn();

  constructor(sandboxId: string) {
    this.sandboxId = sandboxId;
  }
}

const sandboxClientListMock = vi.fn();
const sandboxClientCreateMock = vi.fn();
const sandboxClientForCloudMock = vi.fn();

vi.mock('@tribunal/github/cache', () => ({
  createCache: createCacheMock,
}));

vi.mock('@tribunal/github/reviews/check-runs', () => ({
  createCheckRun: createCheckRunMock,
  updateCheckRun: updateCheckRunMock,
}));

vi.mock('@tribunal/github/reviews/diff-context', () => ({
  getDiffContext: getDiffContextMock,
  getPullRequestMetadata: getPullRequestMetadataMock,
}));

vi.mock('@tribunal/github/reviews/read-tokens', () => ({
  mintSingleRepositoryReadToken: mintReadTokenMock,
}));

vi.mock('@tribunal/github/reviews/pull-request-reviews', () => ({
  findPostedPullRequestReview: findPostedReviewMock,
  postPullRequestReview: postReviewMock,
}));

vi.mock('tensorlake', () => ({
  Sandbox: MockSandbox,
  SandboxClient: {
    forCloud: sandboxClientForCloudMock,
  },
}));

const {
  createEngineGitHubPort,
  createEngineGithubContext,
  createEngineSandboxPort,
  createDatabaseReviewWorkflowStatePort,
  createReviewIntentConsumer,
  createReviewIntentConsumerFromEnvironment,
  createAnthropicUsageCostApiClient,
  emptyUsageCostApiClient,
  resolveInstallationId,
  TensorlakeSandboxAdapter,
  unconfiguredUsageCostApiClient,
} = await import('./runtime-ports');
const { createReviewWorkflowDefinitions } = await import('./review-workflow-definitions');

let testDatabase: TestDatabase;

beforeEach(async () => {
  vi.clearAllMocks();
  resetIdCounter();
  testDatabase ??= await createTestDatabase();
  await testDatabase.reset();
  sandboxClientForCloudMock.mockReturnValue({
    list: sandboxClientListMock,
    create: sandboxClientCreateMock,
  });
  sandboxClientListMock.mockResolvedValue([]);
  sandboxClientCreateMock.mockResolvedValue({ sandboxId: 'sandbox_1' });
  getInstallationOctokitMock.mockResolvedValue({});
  getPullRequestMetadataMock.mockResolvedValue({
    headSha: 'head',
    baseSha: 'base',
    title: 'Review engine foundation',
    body: 'Pull request body',
    labels: ['review-engine'],
    author: 'steve',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('runtime review intent consumer wiring', () => {
  it('does not create a consumer when the app database is unavailable', () => {
    expect(createReviewIntentConsumerFromEnvironment({})).toBeUndefined();
  });

  it('builds a consumer that drains through the review workflow engine', async () => {
    const database = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Database;

    const consumer = createReviewIntentConsumer(database, runtimeEnvironment());

    expect(Object.keys(consumer.workflows)).toEqual([
      'review-pr',
      'review-run',
      'agent-review',
      'sandbox-reaper',
    ]);
    await expect(consumer.drain()).resolves.toBe(0);
    await expect(consumer.stopReviewRun('missing-run')).resolves.toEqual({ stopped: false });
    await expect(consumer.stopReviewAgent('missing-run', 'missing-agent')).resolves.toEqual({
      stopped: false,
    });
  });

  it('creates a consumer from DATABASE_URL and exposes an empty reconciliation client', async () => {
    expect(createReviewIntentConsumerFromEnvironment(runtimeEnvironment())).toBeDefined();
    await expect(emptyUsageCostApiClient.listReviewRunCosts()).resolves.toEqual([]);
    await expect(unconfiguredUsageCostApiClient.listReviewRunCosts()).rejects.toThrow(
      'Authoritative usage cost reconciliation is not configured.',
    );
  });

  it('fetches and parses Anthropic cost report rows for a review run', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'cost_1',
            amount_usd: '1.25',
            starting_at: '2026-06-17T12:00:00.000Z',
            metadata: {
              review_run_id: 'run_1',
              user_id: '7',
              repository_id: '42',
              agent_run_id: 'agent_run_1',
              agent_id: 'agent_security',
            },
          },
          {
            id: 'cost_other',
            amount_usd: '3',
            metadata: { review_run_id: 'run_other', user_id: '7' },
          },
          {
            id: 'cost_zero',
            amount_usd: '0',
            metadata: { review_run_id: 'run_1', user_id: '7' },
          },
          {
            id: 'cost_userless',
            amount_usd: '2',
            metadata: { review_run_id: 'run_1' },
          },
          'ignored',
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-18T12:00:00.000Z'));

    const client = createAnthropicUsageCostApiClient('admin-key');
    await expect(client.listReviewRunCosts('run_1')).resolves.toEqual([
      {
        id: 'cost_1',
        occurredAt: new Date('2026-06-17T12:00:00.000Z'),
        amountUsd: 1.25,
        userId: 7,
        repositoryId: 42,
        reviewRunId: 'run_1',
        agentRunId: 'agent_run_1',
        agentId: 'agent_security',
        metadata: {
          review_run_id: 'run_1',
          user_id: '7',
          repository_id: '42',
          agent_run_id: 'agent_run_1',
          agent_id: 'agent_security',
        },
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining('/v1/organizations/cost_report'),
      }),
      {
        headers: {
          'x-api-key': 'admin-key',
          'anthropic-version': '2023-06-01',
        },
      },
    );
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    expect(url.searchParams.get('starting_at')).toBe('2026-06-11T12:00:00.000Z');
    expect(url.searchParams.get('ending_at')).toBe('2026-06-18T12:00:00.000Z');
  });

  it('normalizes alternate Anthropic cost report row shapes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [
            {
              amountUsd: 2.5,
              ending_at: '2026-06-17T13:00:00.000Z',
              custom_metadata: {
                review_run_id: 'run_2',
                user_id: 8,
              },
              repository_id: 55,
              agent_run_id: '',
              agent_id: 'agent_docs',
            },
          ],
        }),
      }),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-18T12:00:00.000Z'));

    await expect(
      createAnthropicUsageCostApiClient('admin-key').listReviewRunCosts('run_2'),
    ).resolves.toEqual([
      {
        id: 'run_2:0',
        occurredAt: new Date('2026-06-17T13:00:00.000Z'),
        amountUsd: 2.5,
        userId: 8,
        repositoryId: 55,
        reviewRunId: 'run_2',
        agentRunId: null,
        agentId: 'agent_docs',
        metadata: {
          review_run_id: 'run_2',
          user_id: 8,
        },
      },
    ]);
  });

  it('throws when the Anthropic cost report request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    await expect(
      createAnthropicUsageCostApiClient('admin-key').listReviewRunCosts('run_1'),
    ).rejects.toThrow('Anthropic cost report request failed with status 503');
  });

  it('runs the registered review-pr workflow through the review workflow activity', async () => {
    const processClaimedReviewIntent = vi.fn().mockResolvedValue(undefined);
    const engine = await Engine.create({
      storage: new MemoryStorage(),
      workflows: createReviewWorkflowDefinitions({
        processClaimedReviewIntent,
      } as never),
    });

    const handle = await engine.start('review-pr', claimedIntent(), { defer: false });
    await expect(handle.result()).resolves.toEqual({ processed: true });
    expect(processClaimedReviewIntent).toHaveBeenCalledWith(claimedIntent());
  });

  it('runs child workflow registrations through activities and executes the sandbox reaper workflow', async () => {
    const processClaimedReviewIntent = vi.fn().mockResolvedValue(undefined);
    const reapClosedPullRequestSandboxes = vi.fn().mockResolvedValue(['sandbox_1']);
    const engine = await Engine.create({
      storage: new MemoryStorage(),
      workflows: createReviewWorkflowDefinitions({
        processClaimedReviewIntent,
        reapClosedPullRequestSandboxes,
      } as never),
    });

    for (const workflowName of ['review-run', 'agent-review'] as const) {
      const handle = await engine.start(workflowName, claimedIntent(), { defer: false });
      await expect(handle.result()).resolves.toEqual({ processed: true });
    }
    expect(processClaimedReviewIntent).toHaveBeenCalledTimes(2);
    const handle = await engine.start(
      'sandbox-reaper',
      [{ repositoryId: 42, pullRequestNumber: 7 }],
      { defer: false },
    );
    await expect(handle.result()).resolves.toEqual({ reaped: true });
    expect(reapClosedPullRequestSandboxes).toHaveBeenCalledWith([
      { repositoryId: 42, pullRequestNumber: 7 },
    ]);
  });

  it('runs sandbox reaping through the local workflow engine before Weft is bound', async () => {
    await createRunnableReviewIntentFixture();
    const consumer = createReviewIntentConsumer(testDatabase.db, runtimeEnvironment());

    await expect(consumer.reapClosedPullRequestSandboxes()).resolves.toEqual([]);
  });

  it('dispatches sandbox reaping through the bound Weft engine with open pull requests', async () => {
    await createRunnableReviewIntentFixture();
    await testDatabase.db.insert(pullRequestState).values({
      repositoryId: 42,
      prNumber: 8,
      state: 'closed',
      headSha: 'b'.repeat(40),
    });
    const consumer = createReviewIntentConsumer(testDatabase.db, runtimeEnvironment());
    const result = vi.fn().mockResolvedValue({ reaped: true });
    const start = vi.fn().mockResolvedValue({ result });
    consumer.bindWorkflowEngine({ start });

    await expect(consumer.reapClosedPullRequestSandboxes()).resolves.toEqual({ reaped: true });

    expect(start).toHaveBeenCalledWith(
      'sandbox-reaper',
      [{ repositoryId: 42, pullRequestNumber: 7 }],
      {
        id: 'sandbox-reaper',
        onTerminalConflict: 'start-new',
        defer: false,
      },
    );
    expect(result).toHaveBeenCalled();
  });

  it('dispatches claimed review intents through the bound Weft engine', async () => {
    await createRunnableReviewIntentFixture();
    const consumer = createReviewIntentConsumer(testDatabase.db, runtimeEnvironment());
    const result = vi.fn().mockResolvedValue({ processed: true });
    const start = vi.fn().mockResolvedValue({ result });
    consumer.bindWorkflowEngine({ start });

    await expect(consumer.drain(1)).resolves.toBe(1);

    expect(start).toHaveBeenCalledWith(
      'review-pr',
      expect.objectContaining({ id: 'intent_1' }),
      expect.objectContaining({
        id: 'review:pr:42:7',
        onTerminalConflict: 'start-new',
        defer: false,
      }),
    );
    expect(result).toHaveBeenCalled();
    await waitForIntent('intent_1', (intent) => intent.processedAt !== null);
    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent?.processedAt).toBeInstanceOf(Date);
  });

  it('records failed review intents when a started workflow later fails', async () => {
    await createRunnableReviewIntentFixture();
    const consumer = createReviewIntentConsumer(testDatabase.db, runtimeEnvironment());
    const result = vi.fn().mockRejectedValue(new Error('workflow result failed'));
    const start = vi.fn().mockResolvedValue({ result });
    consumer.bindWorkflowEngine({ start });

    await expect(consumer.drain(1)).resolves.toBe(0);
    await waitForIntent('intent_1', (intent) => intent.failureCount === 1);

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      claimedAt: null,
      processedAt: null,
      failureCount: 1,
      lastError: 'workflow result failed',
      nextAttemptAt: expect.any(Date),
    });
  });

  it('does not fail bound review intents when another worker owns the review post claim', async () => {
    await createRunnableReviewIntentFixture();
    const consumer = createReviewIntentConsumer(testDatabase.db, runtimeEnvironment());
    const result = vi.fn().mockRejectedValue(
      Object.assign(new Error('Review post is already claimed for run:42:7:head:opened.'), {
        name: 'ReviewPostAlreadyClaimedError',
      }),
    );
    const start = vi.fn().mockResolvedValue({ result });
    consumer.bindWorkflowEngine({ start });

    await expect(consumer.drain(1)).resolves.toBe(0);

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      claimedAt: expect.any(Date),
      processedAt: null,
      failedAt: null,
      failureCount: 0,
      lastError: null,
      nextAttemptAt: null,
    });
  });

  it('marks bound review intents processed only after workflow completion', async () => {
    await createRunnableReviewIntentFixture();
    const consumer = createReviewIntentConsumer(testDatabase.db, runtimeEnvironment());
    let completeWorkflow: (value: unknown) => void = () => {};
    const result = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        completeWorkflow = resolve;
      }),
    );
    const start = vi.fn().mockResolvedValue({ result });
    consumer.bindWorkflowEngine({ start });

    const drain = consumer.drain(1);
    await vi.waitFor(() => expect(result).toHaveBeenCalled());

    const [inProgressIntent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(inProgressIntent).toMatchObject({
      processedAt: null,
      failureCount: 0,
    });

    completeWorkflow({ processed: true });

    await expect(drain).resolves.toBe(1);
    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      processedAt: expect.any(Date),
      failureCount: 0,
    });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not count or fail bound review intents when a stale claim loses processing', async () => {
    await createRunnableReviewIntentFixture();
    const consumer = createReviewIntentConsumer(testDatabase.db, runtimeEnvironment());
    let completeWorkflow: (value: unknown) => void = () => {};
    const result = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        completeWorkflow = resolve;
      }),
    );
    const start = vi.fn().mockResolvedValue({ result });
    consumer.bindWorkflowEngine({ start });

    const drain = consumer.drain(1);
    await vi.waitFor(() => expect(result).toHaveBeenCalled());
    const [inProgressIntent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(inProgressIntent?.claimedAt).toBeInstanceOf(Date);
    const secondClaimedAt = new Date(inProgressIntent!.claimedAt!.getTime() + 6 * 60 * 1_000);
    await testDatabase.db
      .update(reviewIntent)
      .set({ claimedAt: secondClaimedAt })
      .where(eq(reviewIntent.id, 'intent_1'));

    completeWorkflow({ processed: true });

    await expect(drain).resolves.toBe(0);
    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      claimedAt: secondClaimedAt,
      processedAt: null,
      failedAt: null,
      failureCount: 0,
      lastError: null,
    });
  });

  it('records failed review intents with backoff when bound workflow dispatch fails', async () => {
    await createRunnableReviewIntentFixture();
    const consumer = createReviewIntentConsumer(testDatabase.db, runtimeEnvironment());
    consumer.bindWorkflowEngine({ start: vi.fn().mockRejectedValue(new Error('workflow failed')) });

    await expect(consumer.drain(1)).resolves.toBe(0);

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      claimedAt: null,
      processedAt: null,
      failureCount: 1,
      lastError: 'workflow failed',
    });
    expect(intent?.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('continues draining later intents after one workflow dispatch fails', async () => {
    await createRunnableReviewIntentFixture();
    const [existingIntent] = await testDatabase.db
      .select({ userId: reviewIntent.userId })
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    await testDatabase.db.insert(reviewIntent).values({
      id: 'intent_2',
      deliveryId: 'delivery_2',
      kind: 'start',
      repositoryId: 42,
      userId: existingIntent!.userId,
      prNumber: 8,
      headSha: 'b'.repeat(40),
    });
    await testDatabase.db.insert(pullRequestState).values({
      repositoryId: 42,
      prNumber: 8,
      state: 'open',
      headSha: 'b'.repeat(40),
    });
    const consumer = createReviewIntentConsumer(testDatabase.db, runtimeEnvironment());
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error('workflow failed'))
      .mockResolvedValueOnce({ result: vi.fn().mockResolvedValue({ processed: true }) });
    consumer.bindWorkflowEngine({ start });

    await expect(consumer.drain(2)).resolves.toBe(1);
    await waitForIntent('intent_2', (intent) => intent.processedAt !== null);

    const rows = await testDatabase.db.select().from(reviewIntent).orderBy(reviewIntent.id);
    expect(rows[0]).toMatchObject({
      id: 'intent_1',
      processedAt: null,
      failureCount: 1,
      lastError: 'workflow failed',
    });
    expect(rows[1]?.processedAt).toBeInstanceOf(Date);
  });
});

describe('database review workflow state port', () => {
  it('returns an empty state for a pull request with no persisted review runs', async () => {
    await createRepositoryInstallation();
    const port = createDatabaseReviewWorkflowStatePort(testDatabase.db);

    await expect(
      port.loadPullRequestState({
        userId: 1,
        repositoryId: 42,
        installationId: 1001,
        repository: { owner: 'lostgradient', name: 'tribunal' },
        pullRequestNumber: 7,
        headSha: 'aaa111',
        trigger: 'opened',
        agents: [],
        dailyCostCapUsd: 25,
        ignoreGlobs: [],
      }),
    ).resolves.toEqual({ reviewRuns: [], agentRuns: [] });
  });

  it('upserts and reloads review and agent run state for a pull request', async () => {
    const { repository: createdRepository, installation } = await createRepositoryInstallation();
    await testDatabase.db.insert(agent).values({
      id: 'agent_security',
      userId: installation.userId!,
      slug: 'security-review',
      description: 'Reviews security changes.',
      body: 'Find security problems.',
      model: 'claude-sonnet-4-6',
    });
    const port = createDatabaseReviewWorkflowStatePort(testDatabase.db);

    await port.upsertReviewRun({
      id: 'run:42:7:aaa111:opened',
      idempotencyKey: 'review:run:42:7:aaa111:opened',
      workflowId: 'review:pr:42:7',
      userId: installation.userId!,
      repositoryId: createdRepository.id,
      pullRequestNumber: 7,
      headSha: 'aaa111',
      trigger: 'opened',
      status: 'running',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 0,
      costEstimateUsd: 0,
      startedAt: new Date('2026-06-17T12:00:00.000Z'),
    });
    await port.upsertAgentRun({
      id: 'arun:run:42:7:aaa111:opened:agent_security',
      idempotencyKey: 'agent:run:42:7:aaa111:opened:agent_security',
      reviewRunId: 'run:42:7:aaa111:opened',
      userId: installation.userId!,
      agentId: 'agent_security',
      status: 'succeeded',
      findingsCount: 2,
      costEstimateUsd: 0.25,
      modelUsed: 'claude-sonnet-4-6',
      effortUsed: 'medium',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheCreationTokens: 2,
      },
      durationMs: 25,
    });
    await port.upsertAgentEvent?.({
      agentRunId: 'arun:run:42:7:aaa111:opened:agent_security',
      seq: 1,
      kind: 'tool_pre',
      tool: 'Read',
      detail: { path: 'src/auth.ts' },
      at: '2026-06-17T12:00:05.000Z',
    });
    await port.upsertAgentEvent?.({
      agentRunId: 'arun:run:42:7:aaa111:opened:agent_security',
      seq: 1,
      kind: 'tool_post',
      tool: 'Read',
      detail: { path: 'src/auth.ts', ok: true },
      at: '2026-06-17T12:00:06.000Z',
    });
    await port.upsertFinding?.({
      id: 'finding_1',
      userId: installation.userId!,
      agentRunId: 'arun:run:42:7:aaa111:opened:agent_security',
      path: 'src/auth.ts',
      startLine: 12,
      endLine: null,
      side: 'RIGHT',
      severity: 'warning',
      title: 'Missing authorization check',
      body: 'Add an authorization check.',
      anchored: true,
      fingerprint: 'fingerprint_1',
    });
    await port.upsertFinding?.({
      id: 'finding_1_retry',
      userId: installation.userId!,
      agentRunId: 'arun:run:42:7:aaa111:opened:agent_security',
      path: 'src/auth.ts',
      startLine: 12,
      endLine: null,
      side: 'RIGHT',
      severity: 'warning',
      title: 'Missing authorization check',
      body: 'Updated body.',
      anchored: true,
      fingerprint: 'fingerprint_1',
    });
    await port.upsertReviewRun({
      id: 'run:42:7:aaa111:opened',
      idempotencyKey: 'review:run:42:7:aaa111:opened',
      workflowId: 'review:pr:42:7',
      userId: installation.userId!,
      repositoryId: createdRepository.id,
      pullRequestNumber: 7,
      headSha: 'aaa111',
      trigger: 'opened',
      status: 'posted',
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 2,
      costEstimateUsd: 0.25,
      startedAt: new Date('2026-06-17T12:00:00.000Z'),
      finishedAt: new Date('2026-06-17T12:01:00.000Z'),
    });

    const state = await port.loadPullRequestState({
      userId: installation.userId!,
      repositoryId: createdRepository.id,
      installationId: installation.installationId,
      repository: { owner: createdRepository.owner, name: createdRepository.name },
      pullRequestNumber: 7,
      headSha: 'aaa111',
      trigger: 'opened',
      agents: [],
      dailyCostCapUsd: 25,
    });

    expect(state.reviewRuns).toEqual([
      expect.objectContaining({
        id: 'run:42:7:aaa111:opened',
        status: 'posted',
        commentsPosted: 2,
        costEstimateUsd: 0.25,
        sandboxId: 'sandbox-existing',
        checkRunId: 9001,
      }),
    ]);
    expect(state.agentRuns).toEqual([
      expect.objectContaining({
        id: 'arun:run:42:7:aaa111:opened:agent_security',
        status: 'succeeded',
        userId: installation.userId,
        findingsCount: 2,
        costEstimateUsd: 0.25,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 1,
          cacheCreationTokens: 2,
        },
      }),
    ]);
    await expect(testDatabase.db.select().from(reviewRun)).resolves.toHaveLength(1);
    await expect(testDatabase.db.select().from(agentRun)).resolves.toHaveLength(1);
    await expect(testDatabase.db.select().from(finding)).resolves.toEqual([
      expect.objectContaining({
        id: 'finding_1',
        agentRunId: 'arun:run:42:7:aaa111:opened:agent_security',
        fingerprint: 'fingerprint_1',
        body: 'Updated body.',
      }),
    ]);
    await expect(testDatabase.db.select().from(agentEvent)).resolves.toEqual([
      expect.objectContaining({
        agentRunId: 'arun:run:42:7:aaa111:opened:agent_security',
        seq: 1,
        kind: 'tool_post',
        tool: 'Read',
        detail: { path: 'src/auth.ts', ok: true },
      }),
    ]);
  });

  it('claims review posting atomically and reports posted or actively claimed runs', async () => {
    const { repository: createdRepository, installation } = await createRepositoryInstallation();
    const port = createDatabaseReviewWorkflowStatePort(testDatabase.db);
    const run = {
      id: 'run:42:7:aaa111:opened',
      idempotencyKey: 'review:run:42:7:aaa111:opened',
      workflowId: 'review:pr:42:7',
      userId: installation.userId!,
      repositoryId: createdRepository.id,
      pullRequestNumber: 7,
      headSha: 'aaa111',
      trigger: 'opened' as const,
      status: 'running' as const,
      sandboxId: 'sandbox-existing',
      checkRunId: 9001,
      commentsPosted: 0,
      costEstimateUsd: 0,
      startedAt: new Date('2026-06-17T12:00:00.000Z'),
    };
    await port.upsertReviewRun(run);

    await expect(
      port.claimReviewPost(run.id, new Date('2026-06-17T12:01:00.000Z')),
    ).resolves.toEqual({
      status: 'claimed',
      claimedAt: new Date('2026-06-17T12:01:00.000Z'),
    });
    await expect(
      port.ownsReviewPostClaim(run.id, new Date('2026-06-17T12:01:00.000Z')),
    ).resolves.toBe(true);
    await expect(
      port.ownsReviewPostClaim(run.id, new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toBe(false);
    await expect(
      port.refreshReviewPostClaim(
        run.id,
        new Date('2026-06-17T12:00:00.000Z'),
        new Date('2026-06-17T12:01:30.000Z'),
      ),
    ).resolves.toBeUndefined();
    await expect(
      port.refreshReviewPostClaim(
        run.id,
        new Date('2026-06-17T12:01:00.000Z'),
        new Date('2026-06-17T12:01:30.000Z'),
      ),
    ).resolves.toEqual(new Date('2026-06-17T12:01:30.000Z'));
    await expect(
      port.claimReviewPost(run.id, new Date('2026-06-17T12:02:00.000Z')),
    ).resolves.toEqual({
      status: 'claimed_by_other',
      claimedAt: new Date('2026-06-17T12:01:30.000Z'),
    });
    await expect(
      port.claimReviewPost(run.id, new Date('2026-06-17T12:07:00.000Z')),
    ).resolves.toEqual({
      status: 'claimed_by_other',
      claimedAt: new Date('2026-06-17T12:01:30.000Z'),
    });
    await expect(
      port.clearReviewPostClaim(run.id, new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toBe(false);
    await expect(
      port.clearReviewPostClaim(run.id, new Date('2026-06-17T12:01:00.000Z')),
    ).resolves.toBe(false);
    await expect(
      port.clearReviewPostClaim(run.id, new Date('2026-06-17T12:01:30.000Z')),
    ).resolves.toBe(true);
    await expect(
      port.claimReviewPost(run.id, new Date('2026-06-17T12:08:00.000Z')),
    ).resolves.toEqual({
      status: 'claimed',
      claimedAt: new Date('2026-06-17T12:08:00.000Z'),
    });

    await port.upsertReviewRun({ ...run, status: 'failed', commentsPosted: 0 });
    await expect(testDatabase.db.select().from(reviewRun)).resolves.toEqual([
      expect.objectContaining({
        commentsPosted: 0,
        reviewPostClaimedAt: new Date('2026-06-17T12:08:00.000Z'),
      }),
    ]);

    await port.upsertReviewRun({
      ...run,
      commentsPosted: 2,
      reviewPostClaimedAt: undefined,
      status: 'posted',
      finishedAt: new Date('2026-06-17T12:08:00.000Z'),
    });
    await expect(
      port.claimReviewPost(run.id, new Date('2026-06-17T12:09:00.000Z')),
    ).resolves.toEqual({ status: 'already_posted', commentsPosted: 2 });

    await port.upsertReviewRun({ ...run, status: 'failed', commentsPosted: 0 });
    await expect(testDatabase.db.select().from(reviewRun)).resolves.toEqual([
      expect.objectContaining({
        commentsPosted: 2,
        status: 'posted',
        error: null,
        reviewPostClaimedAt: null,
      }),
    ]);

    await port.upsertReviewRun({
      ...run,
      id: 'run:42:7:bbb222:synchronize',
      idempotencyKey: 'review:run:42:7:bbb222:synchronize',
      headSha: 'bbb222',
      trigger: 'synchronize',
      status: 'posted',
      commentsPosted: 0,
      reviewPostClaimedAt: undefined,
      finishedAt: new Date('2026-06-17T12:10:00.000Z'),
    });
    await port.upsertReviewRun({
      ...run,
      id: 'run:42:7:bbb222:synchronize',
      idempotencyKey: 'review:run:42:7:bbb222:synchronize',
      headSha: 'bbb222',
      trigger: 'synchronize',
      status: 'failed',
      commentsPosted: 0,
      error: 'stale failure',
    });
    await expect(
      testDatabase.db
        .select()
        .from(reviewRun)
        .where(eq(reviewRun.id, 'run:42:7:bbb222:synchronize')),
    ).resolves.toEqual([
      expect.objectContaining({
        commentsPosted: 0,
        status: 'posted',
        error: null,
        finishedAt: new Date('2026-06-17T12:10:00.000Z'),
        reviewPostClaimedAt: null,
      }),
    ]);
    await expect(
      port.claimReviewPost('run:42:7:bbb222:synchronize', new Date('2026-06-17T12:11:00.000Z')),
    ).resolves.toEqual({ status: 'already_posted', commentsPosted: 0 });

    await port.upsertReviewRun({
      ...run,
      id: 'run:42:7:ccc333:opened',
      idempotencyKey: 'review:run:42:7:ccc333:opened',
      headSha: 'ccc333',
      status: 'running',
      commentsPosted: 1,
    });
    await port.upsertReviewRun({
      ...run,
      id: 'run:42:7:ccc333:opened',
      idempotencyKey: 'review:run:42:7:ccc333:opened',
      headSha: 'ccc333',
      status: 'cancelled',
      commentsPosted: 1,
      finishedAt: new Date('2026-06-17T12:12:00.000Z'),
    });
    await expect(
      testDatabase.db.select().from(reviewRun).where(eq(reviewRun.id, 'run:42:7:ccc333:opened')),
    ).resolves.toEqual([
      expect.objectContaining({
        commentsPosted: 1,
        status: 'cancelled',
        finishedAt: new Date('2026-06-17T12:12:00.000Z'),
      }),
    ]);
  });
});

describe('engine GitHub port', () => {
  it('resolves the active installation and delegates GitHub write/read operations', async () => {
    const { repository: createdRepository, installation } = await createRepositoryInstallation();
    const context = createGithubContext();
    const port = createEngineGitHubPort(testDatabase.db, context);
    mintReadTokenMock.mockResolvedValue({
      token: 'github-token',
      expiresAt: '2026-06-17T12:00:00.000Z',
    });
    getDiffContextMock.mockResolvedValue({
      changedFiles: [
        {
          path: 'src/example.ts',
          status: 'changed',
          patch: '@@ -1 +1 @@\n-old\n+new',
          commentableLines: [{ side: 'RIGHT', line: 1 }],
        },
      ],
    });
    createCheckRunMock.mockResolvedValue({ id: 88 });
    updateCheckRunMock.mockResolvedValue({ id: 88 });
    postReviewMock.mockResolvedValue({ id: 99 });
    const repositoryContext = {
      owner: 'lostgradient',
      name: 'tribunal',
      installationId: installation.installationId,
      repositoryId: createdRepository.id,
    };

    await expect(
      port.mintReadToken(createdRepository.id, installation.installationId),
    ).resolves.toEqual({
      token: 'github-token',
      expiresAt: new Date('2026-06-17T12:00:00.000Z'),
    });
    await expect(port.getDiffContext(repositoryContext, 7, 'head', 'base')).resolves.toMatchObject({
      headSha: 'head',
      baseSha: 'base',
      changedFiles: [{ path: 'src/example.ts', status: 'modified' }],
      prevHeadSha: 'base',
      pr: {
        number: 7,
        title: 'Review engine foundation',
        body: 'Pull request body',
        labels: ['review-engine'],
        author: 'steve',
      },
    });
    await expect(port.createCheckRun(repositoryContext, 'head')).resolves.toEqual({
      checkRunId: 88,
    });
    await port.updateCheckRun(repositoryContext, 88, {
      status: 'completed',
      conclusion: 'success',
      output: { title: 'Done', summary: 'Done' },
    });
    await expect(
      port.postReview(repositoryContext, 7, {
        headSha: 'head',
        body: 'Review',
        comments: [{ path: 'src/example.ts', body: 'Comment', line: 1, side: 'RIGHT' }],
      }),
    ).resolves.toEqual({ comments: 1 });
    findPostedReviewMock.mockResolvedValue({ id: 100, comments: 1 });
    await expect(
      port.findPostedReview(
        repositoryContext,
        7,
        '<!-- tribunal-review-run:v1:run:42:7:head:opened:signed -->',
      ),
    ).resolves.toEqual({ comments: 1 });

    expect(getDiffContextMock).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        installationId: installation.installationId,
        repositoryId: createdRepository.id,
        headSha: 'head',
        currentHeadSha: 'head',
      }),
    );
    expect(getPullRequestMetadataMock).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        installationId: installation.installationId,
        owner: 'lostgradient',
        repository: 'tribunal',
        pullRequestNumber: 7,
      }),
    );
    expect(updateCheckRunMock).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ completedAt: expect.any(String) }),
    );
  });

  it('throws when no active installation is available for a repository', async () => {
    await expect(
      resolveInstallationId(testDatabase.db, { owner: 'missing', name: 'repository' }),
    ).rejects.toThrow('No active GitHub installation found');
  });

  it('requires execution repository context for GitHub operations', async () => {
    const port = createEngineGitHubPort(testDatabase.db, createGithubContext());

    await expect(
      port.createCheckRun({ owner: 'lostgradient', name: 'tribunal' }, 'head'),
    ).rejects.toThrow('GitHub execution repository is missing installationId.');
  });

  it('resolves an active installation id for a repository', async () => {
    const { repository: createdRepository, installation } = await createRepositoryInstallation();

    await expect(
      resolveInstallationId(testDatabase.db, {
        owner: createdRepository.owner,
        name: createdRepository.name,
      }),
    ).resolves.toBe(installation.installationId);
  });

  it('throws when pull request metadata cannot get an installation client', async () => {
    const { repository: createdRepository } = await createRepositoryInstallation();
    getPullRequestMetadataMock.mockRejectedValue(
      new Error('GitHub installation 1001 is not available.'),
    );
    const port = createEngineGitHubPort(testDatabase.db, createGithubContext());

    await expect(
      port.getDiffContext(
        { owner: createdRepository.owner, name: createdRepository.name, installationId: 1001 },
        7,
        'head',
      ),
    ).rejects.toThrow('GitHub installation 1001 is not available');
  });

  it('creates an engine GitHub context with lazy cache and application thunks', () => {
    const context = createEngineGithubContext(testDatabase.db, runtimeEnvironment());

    expect(context.cache).toBe(cacheMock);
    expect(context.getGithubApplication?.()).toBeTruthy();
  });
});

describe('Tensorlake sandbox adapter', () => {
  it('does not construct the Tensorlake client until the first sandbox operation', () => {
    new TensorlakeSandboxAdapter(runtimeEnvironment());

    expect(sandboxClientForCloudMock).not.toHaveBeenCalled();
  });

  it('creates, reuses, commands, stops, suspends, and terminates sandboxes', async () => {
    const sandbox = new MockSandbox('sandbox_1');
    MockSandbox.connect.mockResolvedValue(sandbox);
    sandbox.run.mockResolvedValue({ exitCode: 0, stdout: '{"ok":true}', stderr: '' });
    const adapter = new TensorlakeSandboxAdapter(runtimeEnvironment());

    await expect(
      adapter.create({
        name: 'tribunal-pr-42-7',
        image: 'tribunal-reviewer',
        cpus: 2,
        memoryMb: 4096,
        diskMb: 20480,
        timeoutSecs: 900,
        allowInternetAccess: false,
        allowOut: ['10.0.0.8/32'],
        secretNames: [],
        env: {},
        metadata: {},
      }),
    ).resolves.toEqual({ sandboxId: 'sandbox_1' });
    await adapter.runCommand('sandbox_1', 'node', ['runner.mjs'], { A: 'B' });
    const startedProcessIds: string[] = [];
    sandbox.startProcess.mockResolvedValue({ pid: 123 });
    sandbox.followOutput.mockImplementation(async function* () {
      yield { line: '{"ok":true}', stream: 'stdout' };
      yield { line: 'warning', stream: 'stderr' };
    });
    sandbox.getProcess.mockResolvedValue({ pid: 123, exitCode: 0 });
    await expect(
      adapter.runTrackedCommand('sandbox_1', 'node', ['runner.mjs'], { A: 'B' }, (processId) =>
        startedProcessIds.push(processId),
      ),
    ).resolves.toEqual({ exitCode: 0, stdout: '{"ok":true}', stderr: 'warning' });
    await adapter.killProcess('sandbox_1', '123');
    await adapter.killProcess('sandbox_1', 'agent-run-id');
    await adapter.suspend('sandbox_1');
    await adapter.terminate('sandbox_1');

    expect(sandboxClientCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'tribunal-pr-42-7' }),
    );
    expect(MockSandbox.connect).toHaveBeenCalledWith({
      sandboxId: 'sandbox_1',
      apiKey: 'tensorlake-key',
      organizationId: undefined,
      projectId: undefined,
    });
    expect(sandbox.run).toHaveBeenCalledWith('node', { args: ['runner.mjs'], env: { A: 'B' } });
    expect(startedProcessIds).toEqual(['123']);
    expect(sandbox.startProcess).toHaveBeenCalledWith('node', {
      args: ['runner.mjs'],
      env: { A: 'B' },
    });
    expect(sandbox.killProcess).toHaveBeenCalledTimes(1);
    expect(sandbox.suspend).toHaveBeenCalledTimes(1);
    expect(sandbox.terminate).toHaveBeenCalledTimes(1);
  });

  it('connects to an existing named sandbox before creating a duplicate', async () => {
    const sandbox = new MockSandbox('sandbox_existing');
    sandboxClientListMock.mockResolvedValue([
      {
        sandboxId: 'sandbox_existing',
        name: 'tribunal-pr-42-7',
        status: 'running',
        network: { allowInternetAccess: false, allowOut: ['10.0.0.8/32'] },
        secretNames: [],
      },
      { sandboxId: 'sandbox_terminated', name: 'tribunal-pr-42-7', status: 'terminated' },
    ]);
    MockSandbox.connect.mockResolvedValue(sandbox);
    const adapter = new TensorlakeSandboxAdapter(runtimeEnvironment());

    await expect(
      adapter.create({
        name: 'tribunal-pr-42-7',
        image: 'tribunal-reviewer',
        cpus: 2,
        memoryMb: 4096,
        diskMb: 20480,
        timeoutSecs: 900,
        allowInternetAccess: false,
        allowOut: ['10.0.0.8/32'],
        secretNames: [],
        env: {},
        metadata: {},
      }),
    ).resolves.toEqual({ sandboxId: 'sandbox_existing' });
    expect(sandboxClientCreateMock).not.toHaveBeenCalled();
  });

  it('fails closed before reusing a named sandbox with unverified isolation', async () => {
    sandboxClientListMock.mockResolvedValue([
      {
        sandboxId: 'sandbox_existing',
        name: 'tribunal-pr-42-7',
        status: 'running',
        network: { allowInternetAccess: true, allowOut: ['0.0.0.0/0'] },
        secretNames: [],
      },
    ]);
    const adapter = new TensorlakeSandboxAdapter(runtimeEnvironment());

    await expect(
      adapter.create({
        name: 'tribunal-pr-42-7',
        image: 'tribunal-reviewer',
        cpus: 2,
        memoryMb: 4096,
        diskMb: 20480,
        timeoutSecs: 900,
        allowInternetAccess: false,
        allowOut: ['10.0.0.8/32'],
        secretNames: [],
        env: {},
        metadata: {},
      }),
    ).rejects.toThrow('existing sandbox isolation could not be verified');
    expect(MockSandbox.connect).not.toHaveBeenCalled();
    expect(sandboxClientCreateMock).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent sandbox creates for the same name', async () => {
    let resolveCreate: ((value: { sandboxId: string }) => void) | undefined;
    sandboxClientCreateMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const adapter = new TensorlakeSandboxAdapter(runtimeEnvironment());
    const input = {
      name: 'tribunal-pr-42-7',
      image: 'tribunal-reviewer',
      cpus: 2,
      memoryMb: 4096,
      diskMb: 20480,
      timeoutSecs: 900,
      allowInternetAccess: false as const,
      allowOut: [],
      secretNames: [] as [],
      env: {},
      metadata: {},
    };
    const firstCreate = adapter.create(input);
    const secondCreate = adapter.create(input);
    resolveCreate?.({ sandboxId: 'sandbox_1' });

    await expect(Promise.all([firstCreate, secondCreate])).resolves.toEqual([
      { sandboxId: 'sandbox_1' },
      { sandboxId: 'sandbox_1' },
    ]);
    expect(sandboxClientCreateMock).toHaveBeenCalledTimes(1);
  });

  it('treats null tracked process exit codes as failures', async () => {
    const sandbox = new MockSandbox('sandbox_1');
    MockSandbox.connect.mockResolvedValue(sandbox);
    sandbox.startProcess.mockResolvedValue({ pid: 123 });
    sandbox.followOutput.mockImplementation(async function* () {
      yield { line: 'partial output', stream: 'stdout' };
    });
    sandbox.getProcess.mockResolvedValue({ pid: 123, exitCode: null });
    const adapter = new TensorlakeSandboxAdapter(runtimeEnvironment());
    await adapter.create({
      name: 'tribunal-pr-42-7',
      image: 'tribunal-reviewer',
      cpus: 2,
      memoryMb: 4096,
      diskMb: 20480,
      timeoutSecs: 900,
      allowInternetAccess: false,
      allowOut: [],
      secretNames: [],
      env: {},
      metadata: {},
    });

    await expect(
      adapter.runTrackedCommand('sandbox_1', 'node', ['runner.mjs'], undefined, async () => {}),
    ).resolves.toMatchObject({ exitCode: 1, stdout: 'partial output' });
  });

  it('creates the review-core sandbox port over the Tensorlake adapter', async () => {
    const port = createEngineSandboxPort(runtimeEnvironment());

    await expect(
      port.ensure('tribunal-pr-42-7', { image: 'ignored', proxyUrl: 'ignored' }),
    ).resolves.toEqual({
      sandboxId: 'sandbox_1',
    });
  });

  it('connects on demand when a command targets a sandbox not cached by this process', async () => {
    const sandbox = new MockSandbox('sandbox_1');
    MockSandbox.connect.mockResolvedValue(sandbox);
    sandbox.run.mockResolvedValue({ exitCode: 0, stdout: '{}', stderr: '' });
    const adapter = new TensorlakeSandboxAdapter(runtimeEnvironment());

    await adapter.runCommand('sandbox_1', 'node', ['runner.mjs']);

    expect(MockSandbox.connect).toHaveBeenCalledWith({
      sandboxId: 'sandbox_1',
      apiKey: 'tensorlake-key',
    });
    expect(sandbox.run).toHaveBeenCalledWith('node', { args: ['runner.mjs'], env: undefined });
  });
});

function runtimeEnvironment() {
  return {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/tribunal',
    REDIS_URL: 'redis://localhost:6379',
    GITHUB_APP_ID: '123',
    GITHUB_APP_PRIVATE_KEY: 'private-key',
    TENSORLAKE_API_KEY: 'tensorlake-key',
    TRIBUNAL_SANDBOX_IMAGE: 'tribunal-reviewer',
    TRIBUNAL_PROXY_URL: 'https://proxy.tribunal.local',
    TRIBUNAL_PROXY_CIDR: '10.0.0.8/32',
    PROXY_SIGNING_KEY: 'proxy-signing-key',
    TRIBUNAL_DEFAULT_MODEL: 'sonnet',
    DEFAULT_DAILY_COST_CAP_USD: '25',
    ANTHROPIC_ADMIN_KEY: 'sk-ant-admin-test',
  };
}

function createGithubContext(): GithubServiceContext {
  return {
    db: testDatabase.db,
    cache: cacheMock,
    getInstallationOctokit: getInstallationOctokitMock,
    getGithubApplication: vi.fn(),
  };
}

async function createRepositoryInstallation() {
  const factories = createFactories(testDatabase.db);
  const user = await factories.user.create();
  const installation = await factories.githubInstallation.createForUser(user.id, {
    installationId: 1001,
  });
  const createdRepository = await factories.repository.create({
    id: 42,
    owner: 'lostgradient',
    name: 'tribunal',
    installationId: installation.installationId,
  });
  await testDatabase.db.insert(githubInstallationRepository).values({
    installationId: installation.installationId,
    repositoryId: createdRepository.id,
    isActive: true,
  });

  const [activeRepository] = await testDatabase.db
    .select()
    .from(repository)
    .where(eq(repository.id, createdRepository.id));
  const [activeInstallation] = await testDatabase.db
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, installation.installationId));

  return { repository: activeRepository!, installation: activeInstallation! };
}

async function createRunnableReviewIntentFixture() {
  const { repository: createdRepository, installation } = await createRepositoryInstallation();
  const [activeInstallation] = await testDatabase.db
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, installation.installationId));

  await testDatabase.db.insert(userReviewSettings).values({
    userId: activeInstallation!.userId,
    dailyCostCapUsd: '25.00',
    reviewsEnabled: true,
  });
  await testDatabase.db.insert(repositoryReviewSettings).values({
    userId: activeInstallation!.userId,
    repositoryId: createdRepository.id,
    watched: true,
  });
  await testDatabase.db.insert(pullRequestState).values({
    repositoryId: createdRepository.id,
    prNumber: 7,
    state: 'open',
    headSha: 'a'.repeat(40),
  });
  await testDatabase.db.insert(agent).values({
    id: 'agent_security',
    userId: activeInstallation!.userId,
    slug: 'security-review',
    description: 'Reviews security changes.',
    body: 'Find security problems.',
    model: 'claude-sonnet-4-6',
  });
  await testDatabase.db.insert(repositoryAgent).values({
    userId: activeInstallation!.userId,
    repositoryId: createdRepository.id,
    agentId: 'agent_security',
  });
  await testDatabase.db.insert(reviewIntent).values({
    id: 'intent_1',
    deliveryId: 'delivery_1',
    kind: 'start',
    repositoryId: createdRepository.id,
    userId: activeInstallation!.userId,
    prNumber: 7,
    headSha: null,
  });
}

async function waitForIntent(
  intentId: string,
  predicate: (intent: typeof reviewIntent.$inferSelect) => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, intentId));
    if (intent !== undefined && predicate(intent)) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Review intent ${intentId} did not reach expected state.`);
}

function claimedIntent() {
  return {
    id: 'intent_1',
    deliveryId: 'delivery_1',
    kind: 'start' as const,
    pullRequest: {
      userId: 1,
      repositoryId: 42,
      installationId: 1001,
      repository: { owner: 'lostgradient', name: 'tribunal' },
      pullRequestNumber: 7,
      headSha: 'a'.repeat(40),
      trigger: 'opened' as const,
      agents: [],
      dailyCostCapUsd: 25,
      ignoreGlobs: [],
    },
    createdAt: new Date('2026-06-17T12:00:00.000Z'),
    claimedAt: new Date('2026-06-17T12:00:00.000Z'),
  };
}
