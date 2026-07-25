import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, resetIdCounter } from '@tribunal/test/factories';
import { eq } from '@tribunal/database/operators';
import {
  agent,
  agentRun,
  costEvent,
  pullRequestReviewRun,
  tribunalRun,
  userReviewSettings,
} from '@tribunal/database/schema';
import { createCostPort, enforceDailyCap, recordLlmEstimate, recordSandbox } from './ledger';
import { CURRENT_PRICING_VERSION, PRICING, sandboxCost } from './pricing';

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

async function createCostFixture() {
  const factories = createFactories(testDatabase.db);
  const user = await factories.user.create();
  const repository = await factories.repository.create({ id: 42 });
  const review = await testDatabase.db
    .insert(tribunalRun)
    .values({
      id: 'run_cost',
      userId: user.id,
      repositoryId: repository.id,
      runKind: 'pull_request_review',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00.000Z'),
      finishedAt: new Date('2026-06-17T12:30:00.000Z'),
    })
    .returning()
    .then(([row]) => row);
  await testDatabase.db.insert(pullRequestReviewRun).values({
    runId: review.id,
    userId: user.id,
    repositoryId: repository.id,
    prNumber: 12,
    headSha: 'abc123',
    trigger: 'opened',
  });
  const reviewer = await testDatabase.db
    .insert(agent)
    .values({
      id: 'agent_security',
      userId: user.id,
      slug: 'security',
      description: 'Reviews security-sensitive changes.',
      body: 'Find security issues.',
    })
    .returning()
    .then(([row]) => row);
  const run = await testDatabase.db
    .insert(agentRun)
    .values({
      id: 'agent_run_security',
      userId: user.id,
      runId: review.id,
      agentId: reviewer.id,
      status: 'succeeded',
    })
    .returning()
    .then(([row]) => row);

  return { user, repository, review, reviewer, run };
}

async function countLlmEvents() {
  return testDatabase.db
    .select()
    .from(costEvent)
    .where(eq(costEvent.kind, 'llm'))
    .then((rows) => rows.length);
}

describe('sandbox pricing', () => {
  it('computes sandbox cost from runtime and resources using versioned pricing', () => {
    const actual = sandboxCost(
      {
        runtimeSeconds: 300,
        storageSeconds: 600,
      },
      {
        cpus: 2,
        memoryMb: 4096,
        storageMb: 20_480,
      },
    );

    const pricing = PRICING['2026-06-17'].sandbox;
    const expected =
      300 * 2 * pricing.cpuSecondUsd +
      300 * 4 * pricing.memoryGbSecondUsd +
      600 * 20 * pricing.storageGbSecondUsd;

    expect(actual).toBe(Number(expected.toFixed(8)));
  });
});

describe('cost ledger', () => {
  it('records sandbox cost idempotently by sandbox and window', async () => {
    const { user, repository, review } = await createCostFixture();
    const input = {
      userId: user.id,
      repositoryId: repository.id,
      reviewRunId: review.id,
      sandboxId: 'sandbox_1',
      window: '2026-06-17T10',
      runtime: { runtimeSeconds: 60 },
      resources: { cpus: 2, memoryMb: 2048, storageMb: 10_240 },
      occurredAt: new Date('2026-06-17T10:05:00.000Z'),
    };

    await recordSandbox(testDatabase.db, input);
    await recordSandbox(testDatabase.db, input);

    const rows = await testDatabase.db
      .select()
      .from(costEvent)
      .where(eq(costEvent.idempotencyKey, 'sandbox:sandbox_1:2026-06-17T10'));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'sandbox',
      source: 'estimate',
      reviewRunId: review.id,
      repositoryId: repository.id,
    });
    expect(rows[0].meta).toMatchObject({ pricingVersion: '2026-06-17' });
  });

  // Per-run cost reconciliation was removed (see #215): the Anthropic cost
  // report endpoint only supports daily buckets grouped by description or
  // workspace_id — it has no run, request, or API-key dimension — so a
  // per-run reconcile could only ever attribute the organization's entire
  // daily spend to a single review run. `createCostPort` no longer exposes a
  // `reconcile` capability at all, and nothing writes `source: 'reconciled'`
  // cost events for a review run anymore.
  it('never writes reconciled cost events for a review run', async () => {
    const { user, repository, review, reviewer, run } = await createCostFixture();
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:30:00.000Z'),
    });

    expect('reconcile' in port).toBe(false);

    // Exercises the standalone ledger function directly, not just the
    // CostPort closure that wraps it.
    await recordLlmEstimate(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      reviewRunId: review.id,
      agentRunId: run.id,
      agentId: reviewer.id,
      amountUsd: 0.4,
      idempotencyKey: `llm:${run.id}:direct-estimate`,
    });
    await port.recordLlmEstimate({
      userId: user.id,
      repositoryId: repository.id,
      reviewRunId: review.id,
      agentRunId: run.id,
      agentId: reviewer.id,
      amountUsd: 0.8,
      idempotencyKey: `llm:${run.id}:estimate`,
    });
    await port.recordSandbox({
      userId: user.id,
      repositoryId: repository.id,
      reviewRunId: review.id,
      sandboxId: 'sandbox_reconcile_check',
      window: '2026-06-17T12:00:00.000Z',
      amountUsd: 0.2,
      pricingVersion: CURRENT_PRICING_VERSION,
      runtime: { runtimeSeconds: 60 },
      resources: { cpus: 2, memoryMb: 4096, storageMb: 20_480 },
      idempotencyKey: 'sandbox:sandbox_reconcile_check:manual',
    });

    const rows = await testDatabase.db
      .select()
      .from(costEvent)
      .where(eq(costEvent.reviewRunId, review.id));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.source === 'estimate')).toBe(true);
    expect(rows.some((row) => row.source === 'reconciled')).toBe(false);
  });

  it('enforces the daily cap with estimate rows only and prevents a caller from recording LLM cost', async () => {
    const { user, review, reviewer, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '2.00' });
    await testDatabase.db.insert(costEvent).values([
      {
        id: 'cost_estimate',
        userId: user.id,
        kind: 'llm',
        source: 'estimate',
        reviewRunId: review.id,
        agentRunId: run.id,
        agentId: reviewer.id,
        amountUsd: '2.00',
        idempotencyKey: 'llm:estimate',
        occurredAt: new Date('2026-06-17T08:00:00.000Z'),
      },
      {
        id: 'cost_reconciled',
        userId: user.id,
        kind: 'llm',
        source: 'reconciled',
        reviewRunId: review.id,
        agentRunId: run.id,
        agentId: reviewer.id,
        amountUsd: '999.00',
        idempotencyKey: 'llm:reconciled',
        occurredAt: new Date('2026-06-17T08:00:00.000Z'),
      },
    ]);

    const before = await countLlmEvents();
    const decision = await enforceDailyCap(
      testDatabase.db,
      user.id,
      new Date('2026-06-17T09:00:00.000Z'),
    );
    if (decision.allowed) {
      await recordLlmEstimate(testDatabase.db, {
        userId: user.id,
        repositoryId: review.repositoryId,
        reviewRunId: review.id,
        agentRunId: run.id,
        agentId: reviewer.id,
        amountUsd: 0.5,
        idempotencyKey: 'llm:blocked:estimate',
      });
    }

    expect(decision).toEqual({ allowed: false, capUsd: 2, spendUsd: 2, remainingUsd: 0 });
    expect(await countLlmEvents()).toBe(before);
  });

  it('creates the review-core cost port over the ledger', async () => {
    const { user, repository, review, reviewer, run } = await createCostFixture();
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:30:00.000Z'),
    });

    await port.recordLlmEstimate({
      userId: user.id,
      repositoryId: repository.id,
      reviewRunId: review.id,
      agentRunId: run.id,
      agentId: reviewer.id,
      amountUsd: 0.8,
      idempotencyKey: `llm:${run.id}:estimate`,
    });
    await port.recordSandbox({
      userId: user.id,
      repositoryId: repository.id,
      reviewRunId: review.id,
      sandboxId: 'sandbox_1',
      window: '2026-06-17T12:00:00.000Z',
      amountUsd: 0.2,
      pricingVersion: CURRENT_PRICING_VERSION,
      runtime: { runtimeSeconds: 60 },
      resources: { cpus: 2, memoryMb: 4096, storageMb: 20_480 },
      idempotencyKey: 'sandbox:sandbox_1:manual',
    });

    await expect(port.enforceDailyCap(user.id)).resolves.toEqual({
      allowed: true,
      capUsd: 25,
      spendUsd: 1,
      remainingUsd: 24,
    });
    const rows = await testDatabase.db
      .select()
      .from(costEvent)
      .where(eq(costEvent.idempotencyKey, `llm:${run.id}:estimate`));
    expect(rows[0]?.repositoryId).toBe(repository.id);
    const sandboxRows = await testDatabase.db
      .select()
      .from(costEvent)
      .where(eq(costEvent.idempotencyKey, 'sandbox:sandbox_1:manual'));
    expect(sandboxRows[0]?.occurredAt).toEqual(new Date('2026-06-17T12:00:00.000Z'));
    expect(sandboxRows[0]?.meta).toMatchObject({
      pricingVersion: CURRENT_PRICING_VERSION,
      runtime: { runtimeSeconds: 60 },
      resources: { cpus: 2, memoryMb: 4096, storageMb: 20_480 },
      sandboxId: 'sandbox_1',
      window: '2026-06-17T12:00:00.000Z',
    });
  });

  it('records sandbox cost port events at shorthand billing window starts', async () => {
    const { user, repository, review } = await createCostFixture();
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:30:00.000Z'),
    });

    await port.recordSandbox({
      userId: user.id,
      repositoryId: repository.id,
      reviewRunId: review.id,
      sandboxId: 'sandbox_2',
      window: '2026-06-17T08',
      amountUsd: 0.2,
      pricingVersion: CURRENT_PRICING_VERSION,
      runtime: { runtimeSeconds: 60 },
      resources: { cpus: 2, memoryMb: 4096, storageMb: 20_480 },
      idempotencyKey: 'sandbox:sandbox_2:manual',
    });

    const rows = await testDatabase.db
      .select()
      .from(costEvent)
      .where(eq(costEvent.idempotencyKey, 'sandbox:sandbox_2:manual'));
    expect(rows[0]?.occurredAt).toEqual(new Date('2026-06-17T08:00:00.000Z'));
  });

  it('reports a blocked daily cap through the review-core cost port', async () => {
    const { user, review, reviewer, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '1.00' });
    await testDatabase.db.insert(costEvent).values({
      id: 'cost_estimate',
      userId: user.id,
      kind: 'llm',
      source: 'estimate',
      reviewRunId: review.id,
      agentRunId: run.id,
      agentId: reviewer.id,
      amountUsd: '1.00',
      idempotencyKey: 'llm:estimate',
      occurredAt: new Date('2026-06-17T08:00:00.000Z'),
    });
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });

    await expect(port.enforceDailyCap(user.id)).resolves.toEqual({
      allowed: false,
      capUsd: 1,
      spendUsd: 1,
      remainingUsd: 0,
    });
  });

  it('uses the configured default daily cap when review settings do not exist', async () => {
    const { user, review, reviewer, run } = await createCostFixture();
    await testDatabase.db.insert(costEvent).values({
      id: 'cost_estimate',
      userId: user.id,
      kind: 'llm',
      source: 'estimate',
      reviewRunId: review.id,
      agentRunId: run.id,
      agentId: reviewer.id,
      amountUsd: '3.00',
      idempotencyKey: 'llm:default-cap-estimate',
      occurredAt: new Date('2026-06-17T08:00:00.000Z'),
    });
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:00:00.000Z'),
      defaultDailyCostCapUsd: 3,
    });

    await expect(port.enforceDailyCap(user.id)).resolves.toEqual({
      allowed: false,
      capUsd: 3,
      spendUsd: 3,
      remainingUsd: 0,
    });
  });
});
