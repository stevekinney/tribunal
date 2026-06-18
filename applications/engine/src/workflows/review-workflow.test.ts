import { describe, expect, it } from 'vitest';
import type {
  AgentEvent,
  AgentResult,
  AgentSpec,
  CheckRunPatch,
  CostPort,
  DiffContext,
  GitHubPort,
  RepoRef,
  ReviewPayload,
  SandboxOptions,
  SandboxPort,
  ScopedToken,
} from '@tribunal/review-core';
import { verifyCapabilityToken } from '@tribunal/review-core/capability-token';
import {
  ReviewWorkflowEngine,
  type ClaimedReviewIntent,
  type PullRequestReviewInput,
  type ReviewIntent,
  type ReviewIntentPort,
} from './review-workflow';

const repository = { owner: 'lostgradient', name: 'tribunal' };

const reviewAgent: AgentSpec = {
  id: 'agent_security',
  userId: 1,
  slug: 'security-review',
  description: 'Looks for risky changes.',
  body: 'Review the pull request for security issues.',
  model: 'sonnet',
  effort: 'medium',
  enabled: true,
};

const performanceAgent: AgentSpec = {
  ...reviewAgent,
  id: 'agent_performance',
  slug: 'performance-review',
  description: 'Looks for performance issues.',
};

const baseInput: PullRequestReviewInput = {
  userId: 1,
  repositoryId: 42,
  installationId: 1001,
  repository,
  pullRequestNumber: 7,
  headSha: 'aaa111',
  trigger: 'opened',
  agents: [reviewAgent],
  dailyCostCapUsd: 10,
};

describe('ReviewWorkflowEngine', () => {
  it('claims review_intent rows and starts one supervisor for duplicate start intents', async () => {
    const ports = createFakePorts();
    ports.intents.enqueue(createIntent('intent_1', 'delivery_1', 'start', baseInput));
    ports.intents.enqueue(createIntent('intent_2', 'delivery_2', 'start', baseInput));
    const engine = createEngine(ports);

    await expect(engine.claimReviewIntents()).resolves.toBe(2);

    const snapshot = engine.snapshot();
    expect(snapshot.supervisors).toHaveLength(1);
    expect(snapshot.supervisors[0]?.workflowId).toBe('review:pr:42:7');
    expect(snapshot.reviewRuns.filter((run) => run.status === 'posted')).toHaveLength(1);
    expect(ports.sandbox.ensureCalls).toHaveLength(1);
    expect(ports.intents.processedIntentIds).toEqual(['intent_1', 'intent_2']);
  });

  it('processes commit and close intents through the claim loop with a processing limit', async () => {
    const ports = createFakePorts();
    ports.intents.enqueue(createIntent('intent_1', 'delivery_1', 'start', baseInput));
    ports.intents.enqueue(
      createIntent('intent_2', 'delivery_2', 'commit_pushed', {
        ...baseInput,
        headSha: 'bbb222',
        trigger: 'synchronize',
      }),
    );
    ports.intents.enqueue({
      ...createIntent('intent_3', 'delivery_3', 'pr_closed', baseInput),
      prState: 'merged',
    });
    const engine = createEngine(ports);

    await expect(engine.claimReviewIntents(2)).resolves.toBe(2);
    expect(ports.intents.processedIntentIds).toEqual(['intent_1', 'intent_2']);

    await expect(engine.claimReviewIntents()).resolves.toBe(1);
    expect(engine.snapshot().supervisors[0]).toMatchObject({ status: 'closed' });
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'success' },
    });
  });

  it('stops in-flight agents, supersedes the stale run, and reuses the sandbox on commit_pushed', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const firstRun = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    const updatedInput = { ...baseInput, headSha: 'bbb222', trigger: 'synchronize' as const };
    const secondRun = engine.signalCommitPushed(updatedInput);
    ports.sandbox.resolveHeldAgents();

    await expect(firstRun).resolves.toMatchObject({ status: 'superseded' });
    await expect(secondRun).resolves.toMatchObject({ status: 'posted', headSha: 'bbb222' });

    const snapshot = engine.snapshot();
    expect(snapshot.reviewRuns.filter((run) => run.status !== 'superseded')).toHaveLength(1);
    expect(ports.sandbox.ensureCalls).toHaveLength(1);
    expect(ports.sandbox.stopCalls).toHaveLength(1);
    expect(ports.sandbox.updateCalls.map((call) => call.head)).toEqual(['aaa111', 'bbb222']);
    expect(snapshot.agentRuns.some((agentRun) => agentRun.stoppedReason === 'superseded')).toBe(
      true,
    );
  });

  it('deduplicates concurrent first review starts for the same pull request', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);

    const firstRun = engine.startPullRequestReview(baseInput);
    const secondRun = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();
    ports.sandbox.resolveHeldAgents();

    await expect(Promise.all([firstRun, secondRun])).resolves.toEqual([
      expect.objectContaining({ id: 'run:42:7:aaa111:opened', status: 'posted' }),
      expect.objectContaining({ id: 'run:42:7:aaa111:opened', status: 'posted' }),
    ]);
    expect(ports.sandbox.ensureCalls).toHaveLength(1);
    expect(ports.github.createdCheckRuns).toEqual(['aaa111']);
  });

  it('returns the existing synchronize run when the same head is signaled twice', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    await engine.startPullRequestReview(baseInput);
    const updatedInput = { ...baseInput, headSha: 'bbb222', trigger: 'synchronize' as const };

    const firstSynchronizeRun = await engine.signalCommitPushed(updatedInput);
    const secondSynchronizeRun = await engine.signalCommitPushed(updatedInput);

    expect(secondSynchronizeRun).toBe(firstSynchronizeRun);
    expect(ports.sandbox.updateCalls.map((call) => call.head)).toEqual(['aaa111', 'bbb222']);
  });

  it('waits for a duplicate running synchronize intent before marking it processed', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    await engine.startPullRequestReview(baseInput);
    ports.sandbox.holdFutureAgentRuns();
    const updatedInput = { ...baseInput, headSha: 'bbb222', trigger: 'synchronize' as const };
    const runningSynchronize = engine.signalCommitPushed(updatedInput);
    await ports.sandbox.waitForRunningAgents(2);
    ports.intents.enqueue(createIntent('intent_1', 'delivery_1', 'commit_pushed', updatedInput));

    const duplicateDrain = engine.claimReviewIntents(1);
    await Promise.resolve();
    expect(ports.intents.processedIntentIds).toEqual([]);

    ports.sandbox.resolveHeldAgents();
    await runningSynchronize;
    await expect(duplicateDrain).resolves.toBe(1);
    expect(ports.intents.processedIntentIds).toEqual(['intent_1']);
    expect(ports.sandbox.updateCalls.map((call) => call.head)).toEqual(['aaa111', 'bbb222']);
  });

  it('retries a same-head synchronize run after the previous attempt failed', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    await engine.startPullRequestReview(baseInput);
    const updatedInput = { ...baseInput, headSha: 'bbb222', trigger: 'synchronize' as const };

    ports.sandbox.failNextUpdate();
    await expect(engine.signalCommitPushed(updatedInput)).rejects.toThrow('sandbox update failed');
    await expect(engine.signalCommitPushed(updatedInput)).resolves.toMatchObject({
      status: 'posted',
      headSha: 'bbb222',
    });

    expect(ports.sandbox.updateCalls.map((call) => call.head)).toEqual([
      'aaa111',
      'bbb222',
      'bbb222',
    ]);
  });

  it('retries a same-head synchronize run after the previous attempt hit the cost cap', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    await engine.startPullRequestReview(baseInput);
    const updatedInput = { ...baseInput, headSha: 'bbb222', trigger: 'synchronize' as const };

    ports.cost.setSpendTodayEstimate(10);
    await expect(engine.signalCommitPushed(updatedInput)).resolves.toMatchObject({
      status: 'quota_blocked',
      headSha: 'bbb222',
    });

    ports.cost.setSpendTodayEstimate(0);
    await expect(engine.signalCommitPushed(updatedInput)).resolves.toMatchObject({
      status: 'posted',
      headSha: 'bbb222',
    });
  });

  it('stops an in-flight agent when the pull request closes', async () => {
    const ports = createFakePorts({ holdAllAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview({
      ...baseInput,
      agents: [performanceAgent, reviewAgent],
    });
    await ports.sandbox.waitForRunningAgent();

    await engine.signalPullRequestClosed(
      { ...baseInput, agents: [performanceAgent, reviewAgent] },
      'closed',
    );
    ports.sandbox.resolveHeldAgents();
    await runningReview;

    expect(ports.sandbox.stopCalls).toEqual(['arun:run:42:7:aaa111:opened:agent_performance']);
  });

  it('terminates the sandbox and finalizes the check run when the pull request closes', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await engine.signalPullRequestClosed(baseInput, 'closed');
    ports.sandbox.resolveHeldAgents();
    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });

    const snapshot = engine.snapshot();
    expect(snapshot.supervisors[0]).toMatchObject({ status: 'closed', activeRunId: undefined });
    expect(ports.sandbox.terminateCalls).toEqual(['sandbox-tribunal-pr-42-7']);
    expect(ports.sandbox.stopCalls).toHaveLength(1);
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'cancelled' },
    });

    await expect(engine.startPullRequestReview(baseInput)).rejects.toThrow(
      'Cannot start a review for a closed pull request supervisor.',
    );
  });

  it('ignores close and stop signals when no matching active work exists', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await engine.signalPullRequestClosed(baseInput, 'closed');
    await engine.stopAgent('missing-run', 'missing-agent', 'timeout');

    expect(engine.snapshot().supervisors).toEqual([]);
    expect(ports.sandbox.stopCalls).toEqual([]);
    expect(ports.sandbox.terminateCalls).toEqual([]);
  });

  it('blocks at the daily cost cap before starting agents', async () => {
    const ports = createFakePorts({ spendTodayEstimate: 10 });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'quota_blocked',
    });

    expect(ports.sandbox.runAgentCalls).toHaveLength(0);
    expect(ports.cost.llmEstimateKeys).toHaveLength(0);
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'neutral' },
    });
  });

  it('records one LLM estimate per agent run even when a retry reaches the cost boundary twice', async () => {
    const ports = createFakePorts({ duplicateCostRecordCalls: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    expect(ports.cost.recordLlmEstimateCalls).toHaveLength(2);
    expect(ports.cost.llmEstimateKeys).toEqual([
      'llm:arun:run:42:7:aaa111:opened:agent_security:estimate',
    ]);
  });

  it('records failed agent results and posts a neutral check run', async () => {
    const ports = createFakePorts({ failAgentRuns: true });
    const engine = createEngine(ports);

    await expect(engine.startPullRequestReview(baseInput)).resolves.toMatchObject({
      status: 'posted',
      commentsPosted: 0,
    });

    expect(engine.snapshot().agentRuns[0]).toMatchObject({
      status: 'failed',
      error: 'sandbox runner failed',
    });
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'neutral' },
    });
  });

  it('passes a signed scoped run token to sandbox operations', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    const runToken = ports.sandbox.updateCalls[0]?.runToken;
    expect(runToken).toBeDefined();
    expect(runToken).not.toContain('run-token:');
    const verification = verifyCapabilityToken(
      runToken!,
      'proxy-signing-key',
      new Date('2026-06-17T12:00:00.000Z'),
    );
    expect(verification).toEqual({
      ok: true,
      claims: expect.objectContaining({
        runId: 'run:42:7:aaa111:opened',
        repositoryId: 42,
        installationId: 1001,
        repositoryOwner: 'lostgradient',
        repositoryName: 'tribunal',
        permissions: ['github:read', 'anthropic:invoke'],
      }),
    });
    expect(ports.sandbox.runAgentCalls[0]?.runToken).toBe(runToken);
    expect(ports.github.mintReadTokenCalls).toEqual([]);
  });

  it('releases a claimed intent when downstream processing fails without aborting the drain loop', async () => {
    const ports = createFakePorts({ failCheckRunCreation: true });
    ports.intents.enqueue(createIntent('intent_1', 'delivery_1', 'start', baseInput));
    const engine = createEngine(ports);

    await expect(engine.claimReviewIntents()).resolves.toBe(0);

    expect(ports.intents.processedIntentIds).toEqual([]);
    expect(ports.intents.failedIntentErrors).toEqual([
      { intentId: 'intent_1', message: 'check run creation failed' },
    ]);
  });

  it('continues claiming later intents after one claimed intent fails', async () => {
    const ports = createFakePorts({ failCheckRunCreationsRemaining: 1 });
    ports.intents.enqueue(createIntent('intent_1', 'delivery_1', 'start', baseInput));
    ports.intents.enqueue(
      createIntent('intent_2', 'delivery_2', 'start', {
        ...baseInput,
        pullRequestNumber: 8,
      }),
    );
    const engine = createEngine(ports);

    await expect(engine.claimReviewIntents(2)).resolves.toBe(1);

    expect(ports.intents.failedIntentErrors).toEqual([
      { intentId: 'intent_1', message: 'check run creation failed' },
    ]);
    expect(ports.intents.processedIntentIds).toEqual(['intent_2']);
  });

  it('stops dispatching agents when the daily cap is reached mid-run', async () => {
    const ports = createFakePorts({ spendTodayEstimate: 9.99, spendAfterFirstEstimate: 10 });
    const engine = createEngine(ports);

    await expect(
      engine.startPullRequestReview({
        ...baseInput,
        agents: [reviewAgent, performanceAgent],
      }),
    ).resolves.toMatchObject({ status: 'quota_blocked' });

    expect(ports.sandbox.runAgentCalls.map((call) => call.agentId)).toEqual(['agent_security']);
    expect(ports.github.reviews).toHaveLength(0);
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: { status: 'completed', conclusion: 'neutral' },
    });
  });

  it('posts deterministic sorted comments for multiple findings', async () => {
    const ports = createFakePorts({ multipleFindings: true });
    const engine = createEngine(ports);

    await engine.startPullRequestReview(baseInput);

    expect(
      ports.github.reviews[0]?.comments.map(
        (comment) => `${comment.path}:${comment.side}:${comment.line}`,
      ),
    ).toEqual([
      'src/example.ts:LEFT:2',
      'src/example.ts:RIGHT:3',
      'src/example.ts:RIGHT:12',
      'src/second.ts:RIGHT:1',
    ]);
  });

  it('supports operator stop for one running agent', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await engine.stopAgent('run:42:7:aaa111:opened', 'agent_security', 'timeout');
    ports.sandbox.resolveHeldAgents();

    await runningReview;
    expect(ports.sandbox.stopCalls).toEqual(['arun:run:42:7:aaa111:opened:agent_security']);
    expect(engine.snapshot().agentRuns[0]).toMatchObject({ stoppedReason: 'timeout' });
  });

  it('cancels a running review through the review-run stop signal', async () => {
    const ports = createFakePorts({ holdAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await expect(engine.stopRun('run:42:7:aaa111:opened', 'timeout')).resolves.toEqual({
      stopped: true,
    });
    ports.sandbox.resolveHeldAgents();

    await expect(runningReview).resolves.toMatchObject({ status: 'cancelled' });
    expect(ports.sandbox.stopCalls).toEqual(['arun:run:42:7:aaa111:opened:agent_security']);
    expect(engine.snapshot().supervisors[0]).toMatchObject({ activeRunId: undefined });
    expect(ports.github.checkRunPatches.at(-1)).toMatchObject({
      patch: {
        status: 'completed',
        conclusion: 'cancelled',
        output: {
          title: 'Tribunal review stopped',
          summary: 'Review run stopped by operator.',
        },
      },
    });
  });

  it('ignores review-run stop signals when no active run matches', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);

    await expect(engine.stopRun('missing-run', 'timeout')).resolves.toEqual({ stopped: false });

    expect(ports.sandbox.stopCalls).toEqual([]);
    expect(ports.github.checkRunPatches).toEqual([]);
  });

  it('records a killed agent as cancelled when the sandbox runner throws after abort', async () => {
    const ports = createFakePorts({ holdAgentRuns: true, failAbortedAgentRuns: true });
    const engine = createEngine(ports);
    const runningReview = engine.startPullRequestReview(baseInput);
    await ports.sandbox.waitForRunningAgent();

    await engine.stopAgent('run:42:7:aaa111:opened', 'agent_security', 'timeout');
    ports.sandbox.resolveHeldAgents();

    await runningReview;
    expect(engine.snapshot().agentRuns[0]).toMatchObject({
      status: 'cancelled',
      stoppedReason: 'timeout',
      error: undefined,
    });
  });

  it('reaps closed pull request sandboxes and leaves open pull request sandboxes alone', async () => {
    const ports = createFakePorts();
    const engine = createEngine(ports);
    await engine.startPullRequestReview({
      ...baseInput,
      repositoryId: 43,
      pullRequestNumber: 8,
      headSha: 'ccc333',
    });
    await engine.startPullRequestReview(baseInput);

    expect(engine.snapshot().supervisors.map((supervisor) => supervisor.workflowId)).toEqual([
      'review:pr:42:7',
      'review:pr:43:8',
    ]);

    await expect(
      engine.reapClosedPullRequestSandboxes([{ repositoryId: 42, pullRequestNumber: 7 }]),
    ).resolves.toEqual(['sandbox-tribunal-pr-43-8']);
    await expect(
      engine.reapClosedPullRequestSandboxes([{ repositoryId: 42, pullRequestNumber: 7 }]),
    ).resolves.toEqual([]);
    expect(ports.sandbox.terminateCalls).toEqual(['sandbox-tribunal-pr-43-8']);
  });
});

function createEngine(ports: FakePorts): ReviewWorkflowEngine {
  return new ReviewWorkflowEngine(
    ports,
    {
      sandboxImage: 'tribunal-reviewer:test',
      proxyUrl: 'https://proxy.example.test',
      proxySigningKey: 'proxy-signing-key',
      runTokenTtlSeconds: 60 * 60,
      maxConcurrentAgents: 2,
    },
    () => new Date('2026-06-17T12:00:00.000Z'),
  );
}

function createIntent(
  id: string,
  deliveryId: string,
  kind: ReviewIntent['kind'],
  pullRequest: PullRequestReviewInput,
): ReviewIntent {
  return {
    id,
    deliveryId,
    kind,
    pullRequest,
    createdAt: new Date('2026-06-17T12:00:00.000Z'),
  };
}

type FakePorts = {
  github: FakeGitHubPort;
  sandbox: FakeSandboxPort;
  cost: FakeCostPort;
  intents: FakeReviewIntentPort;
};

function createFakePorts(options: FakePortOptions = {}): FakePorts {
  return {
    github: new FakeGitHubPort(options),
    sandbox: new FakeSandboxPort(options),
    cost: new FakeCostPort(options),
    intents: new FakeReviewIntentPort(),
  };
}

type FakePortOptions = {
  holdAgentRuns?: boolean;
  holdAllAgentRuns?: boolean;
  spendTodayEstimate?: number;
  duplicateCostRecordCalls?: boolean;
  failAgentRuns?: boolean;
  failCheckRunCreation?: boolean;
  failCheckRunCreationsRemaining?: number;
  failAbortedAgentRuns?: boolean;
  failNextSandboxUpdate?: boolean;
  multipleFindings?: boolean;
  spendAfterFirstEstimate?: number;
};

class FakeReviewIntentPort implements ReviewIntentPort {
  private readonly intents: ReviewIntent[] = [];
  readonly processedIntentIds: string[] = [];
  readonly failedIntentErrors: Array<{ intentId: string; message: string }> = [];

  enqueue(intent: ReviewIntent): void {
    this.intents.push(intent);
  }

  async claimNextReviewIntent(now: Date): Promise<ClaimedReviewIntent | null> {
    const intent = this.intents.shift();
    return intent === undefined ? null : { ...intent, claimedAt: now };
  }

  async markReviewIntentProcessed(intentId: string, _claimedAt: Date, _now: Date): Promise<void> {
    this.processedIntentIds.push(intentId);
  }

  async markReviewIntentFailed(
    intentId: string,
    _claimedAt: Date,
    _now: Date,
    error: unknown,
  ): Promise<void> {
    this.failedIntentErrors.push({
      intentId,
      message: error instanceof Error ? error.message : 'Review intent processing failed.',
    });
  }
}

class FakeGitHubPort implements GitHubPort {
  readonly checkRunPatches: Array<{
    repository: RepoRef;
    checkRunId: number;
    patch: CheckRunPatch;
  }> = [];
  readonly reviews: ReviewPayload[] = [];
  readonly mintReadTokenCalls: Array<{ repositoryId: number; installationId: number }> = [];
  readonly createdCheckRuns: string[] = [];
  private nextCheckRunId = 9000;
  private checkRunCreationFailuresRemaining: number;

  constructor(private readonly options: FakePortOptions = {}) {
    this.checkRunCreationFailuresRemaining =
      options.failCheckRunCreationsRemaining ?? (options.failCheckRunCreation ? Infinity : 0);
  }

  async mintReadToken(repositoryId: number, installationId: number): Promise<ScopedToken> {
    this.mintReadTokenCalls.push({ repositoryId, installationId });
    return { token: 'read-token', expiresAt: new Date('2026-06-17T13:00:00.000Z') };
  }

  async getDiffContext(
    repository: RepoRef,
    pullRequestNumber: number,
    head: string,
    previousHead?: string,
  ): Promise<DiffContext> {
    return {
      headSha: head,
      baseSha: 'base000',
      prevHeadSha: previousHead,
      changedFiles: [
        {
          path: 'src/example.ts',
          status: 'modified',
          patch: '@@ -1 +1 @@',
          commentableLines: [
            { side: 'LEFT', line: 2 },
            { side: 'RIGHT', line: 3 },
            { side: 'RIGHT', line: 12 },
          ],
        },
        {
          path: 'src/second.ts',
          status: 'added',
          patch: '@@ -0,0 +1 @@',
          commentableLines: [{ side: 'RIGHT', line: 1 }],
        },
      ],
      pr: {
        number: pullRequestNumber,
        title: `${repository.owner}/${repository.name}`,
        body: 'Pull request body',
        labels: [],
        author: 'steve',
      },
    };
  }

  async createCheckRun(_repository: RepoRef, headSha: string): Promise<{ checkRunId: number }> {
    if (this.checkRunCreationFailuresRemaining > 0) {
      this.checkRunCreationFailuresRemaining -= 1;
      throw new Error('check run creation failed');
    }
    this.createdCheckRuns.push(headSha);
    this.nextCheckRunId += 1;
    return { checkRunId: this.nextCheckRunId };
  }

  async updateCheckRun(
    repository: RepoRef,
    checkRunId: number,
    patch: CheckRunPatch,
  ): Promise<void> {
    this.checkRunPatches.push({ repository, checkRunId, patch });
  }

  async postReview(
    _repository: RepoRef,
    _pullRequestNumber: number,
    review: ReviewPayload,
  ): Promise<{ comments: number }> {
    this.reviews.push(review);
    return { comments: review.comments.length };
  }
}

class FakeSandboxPort implements SandboxPort {
  readonly ensureCalls: Array<{ prKey: string; options: SandboxOptions }> = [];
  readonly updateCalls: Array<{
    sandboxId: string;
    repository: RepoRef;
    head: string;
    runToken: string;
  }> = [];
  readonly runAgentCalls: Array<{ sandboxId: string; agentId: string; runToken: string }> = [];
  readonly stopCalls: string[] = [];
  readonly terminateCalls: string[] = [];

  private runningAgentResolver: (() => void) | undefined;
  private readonly runningAgentPromise = new Promise<void>((resolve) => {
    this.runningAgentResolver = resolve;
  });
  private runningAgents = 0;
  private readonly heldAgentResolvers: Array<() => void> = [];
  private holdFutureRuns = false;

  constructor(private readonly options: FakePortOptions) {}

  async ensure(prKey: string, options: SandboxOptions): Promise<{ sandboxId: string }> {
    this.ensureCalls.push({ prKey, options });
    return { sandboxId: `sandbox-${prKey}` };
  }

  async update(
    sandboxId: string,
    repository: RepoRef,
    head: string,
    runToken: string,
  ): Promise<void> {
    this.updateCalls.push({ sandboxId, repository, head, runToken });
    if (this.options.failNextSandboxUpdate) {
      this.options.failNextSandboxUpdate = false;
      throw new Error('sandbox update failed');
    }
  }

  async runAgent(
    sandboxId: string,
    _agentRunId: string,
    agent: AgentSpec,
    runToken: string,
    onEvent: (event: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<AgentResult> {
    this.runAgentCalls.push({ sandboxId, agentId: agent.id, runToken });
    this.runningAgents += 1;
    onEvent({
      agentRunId: 'placeholder',
      seq: this.runAgentCalls.length,
      kind: 'session_start',
      at: '2026-06-17T12:00:00.000Z',
    });
    this.runningAgentResolver?.();

    if (
      (this.options.holdAgentRuns && this.runAgentCalls.length === 1) ||
      this.options.holdAllAgentRuns ||
      this.holdFutureRuns
    ) {
      await new Promise<void>((resolve) => {
        this.heldAgentResolvers.push(resolve);
      });
    }

    if (this.options.failAgentRuns) {
      throw new Error('sandbox runner failed');
    }
    if (signal.aborted && this.options.failAbortedAgentRuns) {
      throw new Error('process killed');
    }

    return createAgentResult(agent, signal.aborted, this.options.multipleFindings);
  }

  async stop(_sandboxId: string, agentRunId: string): Promise<void> {
    this.stopCalls.push(agentRunId);
  }

  async suspend(): Promise<void> {}

  async terminate(sandboxId: string): Promise<void> {
    this.terminateCalls.push(sandboxId);
  }

  async waitForRunningAgent(): Promise<void> {
    await this.runningAgentPromise;
  }

  async waitForRunningAgents(count: number): Promise<void> {
    while (this.runningAgents < count) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  resolveHeldAgents(): void {
    for (const resolve of this.heldAgentResolvers.splice(0)) {
      resolve();
    }
  }

  holdFutureAgentRuns(): void {
    this.holdFutureRuns = true;
  }

  failNextUpdate(): void {
    this.options.failNextSandboxUpdate = true;
  }
}

class FakeCostPort implements CostPort {
  readonly recordLlmEstimateCalls: string[] = [];
  readonly reconcileCalls: string[] = [];
  private readonly idempotencyKeys = new Set<string>();
  private spendTodayEstimateValue: number;

  constructor(private readonly options: FakePortOptions) {
    this.spendTodayEstimateValue = options.spendTodayEstimate ?? 0;
  }

  get llmEstimateKeys(): string[] {
    return [...this.idempotencyKeys].sort();
  }

  async recordLlmEstimate(event: { idempotencyKey: string }): Promise<void> {
    this.recordLlmEstimateCalls.push(event.idempotencyKey);
    this.idempotencyKeys.add(event.idempotencyKey);
    if (this.options.duplicateCostRecordCalls) {
      this.recordLlmEstimateCalls.push(event.idempotencyKey);
      this.idempotencyKeys.add(event.idempotencyKey);
    }
    if (this.options.spendAfterFirstEstimate !== undefined) {
      this.spendTodayEstimateValue = this.options.spendAfterFirstEstimate;
    }
  }

  async recordSandbox(): Promise<void> {}

  async reconcile(reviewRunId: string): Promise<void> {
    this.reconcileCalls.push(reviewRunId);
  }

  async spendTodayEstimate(): Promise<number> {
    return this.spendTodayEstimateValue;
  }

  setSpendTodayEstimate(value: number): void {
    this.spendTodayEstimateValue = value;
  }
}

function createAgentResult(
  agent: AgentSpec,
  stopped: boolean,
  multipleFindings = false,
): AgentResult {
  const findings = multipleFindings
    ? [
        {
          path: 'src/second.ts',
          startLine: 1,
          endLine: null,
          side: 'RIGHT' as const,
          severity: 'warning' as const,
          title: 'Second file',
          body: 'This should sort last by path.',
        },
        {
          path: 'src/example.ts',
          startLine: 3,
          endLine: null,
          side: 'RIGHT' as const,
          severity: 'warning' as const,
          title: 'Earlier right side',
          body: 'This should sort before the later right-side comment.',
        },
        {
          path: 'src/example.ts',
          startLine: 12,
          endLine: null,
          side: 'RIGHT' as const,
          severity: 'warning' as const,
          title: 'Right side',
          body: 'This should sort after the left-side comment.',
        },
        {
          path: 'src/example.ts',
          startLine: 2,
          endLine: null,
          side: 'LEFT' as const,
          severity: 'warning' as const,
          title: 'Left side',
          body: 'This should sort first within the file.',
        },
      ]
    : [
        {
          path: 'src/example.ts',
          startLine: 12,
          endLine: null,
          side: 'RIGHT' as const,
          severity: 'warning' as const,
          title: 'Check this change',
          body: 'This fake finding proves review posting stays outside the agent.',
        },
      ];

  return {
    agentSlug: agent.slug,
    findings: stopped ? [] : findings,
    modelUsed: 'claude-sonnet-4-6',
    effortUsed: 'medium',
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    costEstimateUsd: 0.01,
    durationMs: 25,
    stopped: stopped ? 'superseded' : undefined,
  };
}
