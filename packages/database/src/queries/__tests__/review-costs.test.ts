import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, resetIdCounter } from '@tribunal/test/factories';
import { eq } from '../../operators';
import {
  agent,
  agentEvent,
  agentRun,
  costEvent,
  finding,
  repositoryAgent,
  repositoryReviewSettings,
  reviewIntent,
  reviewRun,
  userReviewSettings,
} from '../../schema';
import {
  getCostPerAgent,
  getCostPerAgentPerRepository,
  getCostPerPullRequest,
  getCostPerRepository,
  getCostPerReviewRun,
  getCostPerUserPerDay,
  spendTodayEstimate,
} from '../review-costs';

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
});

afterAll(async () => {
  await testDatabase.close();
});

beforeEach(async () => {
  await testDatabase.reset();
  resetIdCounter();
});

async function createReviewFixture() {
  const factories = createFactories(testDatabase.db);
  const user = await factories.user.create();
  const repository = await factories.repository.create({ id: 1001 });
  const secondaryRepository = await factories.repository.create({ id: 1002 });
  const firstAgent = await testDatabase.db
    .insert(agent)
    .values({
      id: 'agent_security',
      userId: user.id,
      slug: 'security-reviewer',
      description: 'Find security issues.',
      body: 'Review the changed files for security issues.',
      model: 'inherit',
      effort: 'high',
    })
    .returning()
    .then(([row]) => row);
  const secondAgent = await testDatabase.db
    .insert(agent)
    .values({
      id: 'agent_tests',
      userId: user.id,
      slug: 'test-reviewer',
      description: 'Find missing tests.',
      body: 'Review the changed files for missing tests.',
      model: 'claude-sonnet-4-6',
    })
    .returning()
    .then(([row]) => row);
  const firstRun = await testDatabase.db
    .insert(reviewRun)
    .values({
      id: 'run_1',
      userId: user.id,
      repositoryId: repository.id,
      prNumber: 12,
      headSha: 'abc',
      trigger: 'opened',
      status: 'posted',
    })
    .returning()
    .then(([row]) => row);
  const secondRun = await testDatabase.db
    .insert(reviewRun)
    .values({
      id: 'run_2',
      userId: user.id,
      repositoryId: secondaryRepository.id,
      prNumber: 13,
      headSha: 'def',
      trigger: 'synchronize',
      status: 'posted',
    })
    .returning()
    .then(([row]) => row);
  const firstAgentRun = await testDatabase.db
    .insert(agentRun)
    .values({
      id: 'arun_1',
      userId: user.id,
      reviewRunId: firstRun.id,
      agentId: firstAgent.id,
      status: 'succeeded',
    })
    .returning()
    .then(([row]) => row);
  const secondAgentRun = await testDatabase.db
    .insert(agentRun)
    .values({
      id: 'arun_2',
      userId: user.id,
      reviewRunId: firstRun.id,
      agentId: secondAgent.id,
      status: 'succeeded',
    })
    .returning()
    .then(([row]) => row);
  const thirdAgentRun = await testDatabase.db
    .insert(agentRun)
    .values({
      id: 'arun_3',
      userId: user.id,
      reviewRunId: secondRun.id,
      agentId: firstAgent.id,
      status: 'succeeded',
    })
    .returning()
    .then(([row]) => row);

  await testDatabase.db.insert(costEvent).values([
    {
      id: 'cost_1',
      userId: user.id,
      kind: 'llm',
      source: 'estimate',
      repositoryId: repository.id,
      reviewRunId: firstRun.id,
      agentRunId: firstAgentRun.id,
      agentId: firstAgent.id,
      amountUsd: '1.25',
      idempotencyKey: 'llm:arun_1:estimate',
      occurredAt: new Date('2026-06-17T10:00:00.000Z'),
    },
    {
      id: 'cost_2',
      userId: user.id,
      kind: 'llm',
      source: 'estimate',
      repositoryId: repository.id,
      reviewRunId: firstRun.id,
      agentRunId: secondAgentRun.id,
      agentId: secondAgent.id,
      amountUsd: '0.75',
      idempotencyKey: 'llm:arun_2:estimate',
      occurredAt: new Date('2026-06-17T11:00:00.000Z'),
    },
    {
      id: 'cost_3',
      userId: user.id,
      kind: 'sandbox',
      source: 'estimate',
      repositoryId: secondaryRepository.id,
      reviewRunId: secondRun.id,
      agentRunId: thirdAgentRun.id,
      agentId: firstAgent.id,
      amountUsd: '2.00',
      idempotencyKey: 'sandbox:sbx_1:window_1',
      occurredAt: new Date('2026-06-17T12:00:00.000Z'),
    },
    {
      id: 'cost_4',
      userId: user.id,
      kind: 'llm',
      source: 'reconciled',
      repositoryId: repository.id,
      reviewRunId: firstRun.id,
      agentRunId: firstAgentRun.id,
      agentId: firstAgent.id,
      amountUsd: '1.10',
      idempotencyKey: 'llm:arun_1:reconciled',
      occurredAt: new Date('2026-06-17T13:00:00.000Z'),
    },
  ]);

  return { user, repository, secondaryRepository, firstAgent, secondAgent };
}

describe('review contract schema', () => {
  it('applies the review contract migration with the required tables and indexes', async () => {
    const result = await testDatabase.client.exec(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    const tableRows = (result[0]?.rows ?? []) as Array<{ tablename: string }>;
    const tableNames = new Set(tableRows.map((row) => row.tablename));

    for (const tableName of [
      'agent',
      'repository_agent',
      'repository_review_settings',
      'user_review_settings',
      'review_run',
      'agent_run',
      'finding',
      'agent_event',
      'review_intent',
      'cost_event',
    ]) {
      expect(tableNames.has(tableName)).toBe(true);
    }

    const indexResult = await testDatabase.client.exec(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
    );
    const indexRows = (indexResult[0]?.rows ?? []) as Array<{ indexname: string }>;
    const indexNames = new Set(indexRows.map((row) => row.indexname));

    for (const indexName of [
      'cost_event_user_occurred_idx',
      'cost_event_review_run_idx',
      'cost_event_repository_agent_idx',
      'cost_event_source_idx',
      'review_run_repository_pr_status_idx',
      'agent_run_review_run_idx',
      'finding_agent_run_idx',
      'agent_event_agent_run_idx',
      'review_intent_unprocessed_claimed_idx',
    ]) {
      expect(indexNames.has(indexName)).toBe(true);
    }
  });

  it('enforces documented unique and check constraints', async () => {
    const { user, repository, firstAgent } = await createReviewFixture();

    await expect(
      testDatabase.db.insert(agent).values({
        id: 'agent_bad_model',
        userId: user.id,
        slug: 'bad-model',
        description: 'Invalid model.',
        body: 'Invalid model.',
        model: 'gpt-5',
      }),
    ).rejects.toThrow();

    await expect(
      testDatabase.db.insert(reviewRun).values({
        id: 'run_duplicate',
        userId: user.id,
        repositoryId: repository.id,
        prNumber: 12,
        headSha: 'abc',
        trigger: 'opened',
      }),
    ).rejects.toThrow();

    await expect(
      testDatabase.db.insert(reviewIntent).values([
        {
          id: 'intent_1',
          deliveryId: 'delivery-1',
          kind: 'start',
          repositoryId: repository.id,
          prNumber: 12,
          headSha: 'abc',
        },
        {
          id: 'intent_2',
          deliveryId: 'delivery-1',
          kind: 'start',
          repositoryId: repository.id,
          prNumber: 12,
          headSha: 'abc',
        },
      ]),
    ).rejects.toThrow();

    await expect(
      testDatabase.db.insert(repositoryAgent).values([
        { repositoryId: repository.id, agentId: firstAgent.id },
        { repositoryId: repository.id, agentId: firstAgent.id },
      ]),
    ).rejects.toThrow();
  });

  it('supports idempotent cost event insertion by idempotency key', async () => {
    const { user, repository, firstAgent } = await createReviewFixture();

    await testDatabase.db
      .insert(costEvent)
      .values({
        id: 'cost_duplicate',
        userId: user.id,
        kind: 'llm',
        source: 'estimate',
        repositoryId: repository.id,
        agentId: firstAgent.id,
        amountUsd: '9.99',
        idempotencyKey: 'llm:arun_1:estimate',
      })
      .onConflictDoNothing({ target: costEvent.idempotencyKey });

    const rows = await testDatabase.db
      .select()
      .from(costEvent)
      .where(eq(costEvent.idempotencyKey, 'llm:arun_1:estimate'));

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('cost_1');
  });

  it('writes settings, findings, and agent events through the schema contract', async () => {
    const { user, repository } = await createReviewFixture();

    await testDatabase.db.insert(userReviewSettings).values({ userId: user.id });
    await testDatabase.db
      .insert(repositoryReviewSettings)
      .values({ repositoryId: repository.id, watched: true, ignoreGlobs: ['**/*.md'] });
    await testDatabase.db.insert(finding).values({
      id: 'find_1',
      userId: user.id,
      agentRunId: 'arun_1',
      path: 'src/auth.ts',
      startLine: 10,
      endLine: 12,
      side: 'RIGHT',
      severity: 'warning',
      title: 'Validate input',
      body: 'The input needs validation.',
      fingerprint: 'fingerprint-1',
    });
    await testDatabase.db.insert(agentEvent).values({
      agentRunId: 'arun_1',
      seq: 1,
      kind: 'tool_pre',
      tool: 'Read',
      detail: { path: 'src/auth.ts' },
    });

    const [settings] = await testDatabase.db.select().from(repositoryReviewSettings);
    const [event] = await testDatabase.db.select().from(agentEvent);

    expect(settings.watched).toBe(true);
    expect(settings.ignoreGlobs).toEqual(['**/*.md']);
    expect(event.detail).toEqual({ path: 'src/auth.ts' });
  });
});

describe('review cost rollups', () => {
  it('returns the six required rollups and spendTodayEstimate', async () => {
    const { user, repository, secondaryRepository, firstAgent, secondAgent } =
      await createReviewFixture();

    expect(await getCostPerReviewRun(testDatabase.db, { source: 'estimate' })).toEqual([
      { reviewRunId: 'run_1', amountUsd: 2 },
      { reviewRunId: 'run_2', amountUsd: 2 },
    ]);
    expect(await getCostPerPullRequest(testDatabase.db, { source: 'estimate' })).toEqual([
      { repositoryId: repository.id, prNumber: 12, amountUsd: 2 },
      { repositoryId: secondaryRepository.id, prNumber: 13, amountUsd: 2 },
    ]);
    expect(await getCostPerRepository(testDatabase.db, { source: 'estimate' })).toEqual([
      { repositoryId: repository.id, amountUsd: 2 },
      { repositoryId: secondaryRepository.id, amountUsd: 2 },
    ]);
    expect(await getCostPerAgent(testDatabase.db, { source: 'estimate' })).toEqual([
      { agentId: firstAgent.id, amountUsd: 3.25 },
      { agentId: secondAgent.id, amountUsd: 0.75 },
    ]);
    expect(await getCostPerAgentPerRepository(testDatabase.db, { source: 'estimate' })).toEqual([
      { agentId: firstAgent.id, repositoryId: repository.id, amountUsd: 1.25 },
      { agentId: firstAgent.id, repositoryId: secondaryRepository.id, amountUsd: 2 },
      { agentId: secondAgent.id, repositoryId: repository.id, amountUsd: 0.75 },
    ]);
    expect(await getCostPerUserPerDay(testDatabase.db, { source: 'estimate' })).toEqual([
      { userId: user.id, day: new Date('2026-06-17T00:00:00.000Z'), amountUsd: 4 },
    ]);
    await expect(
      spendTodayEstimate(testDatabase.db, user.id, new Date('2026-06-17T20:00:00.000Z')),
    ).resolves.toBe(4);
  });
});
