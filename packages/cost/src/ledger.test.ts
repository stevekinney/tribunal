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
import {
  createCostPort,
  enforceDailyCap,
  getReviewRunCostComparison,
  reconcile,
  recordLlmEstimate,
  recordSandbox,
} from './ledger';
import { CURRENT_PRICING_VERSION, PRICING, sandboxCost } from './pricing';
import type { UsageCostApiClient } from './usage-cost-api';

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

  it('reconciles Usage and Cost API rows without removing estimates', async () => {
    const { user, repository, review, reviewer, run } = await createCostFixture();
    await recordLlmEstimate(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      reviewRunId: review.id,
      agentRunId: run.id,
      agentId: reviewer.id,
      amountUsd: 1.25,
      idempotencyKey: `llm:${run.id}:estimate`,
    });
    let receivedTarget: Parameters<UsageCostApiClient['listReviewRunCosts']>[0] | undefined;
    const client: UsageCostApiClient = {
      async listReviewRunCosts(target) {
        receivedTarget = target;
        return [
          {
            id: 'usage_2',
            occurredAt: new Date('2026-06-17T12:01:00.000Z'),
            amountUsd: 1.1,
            userId: user.id,
            repositoryId: repository.id,
            reviewRunId: target.reviewRunId,
            agentRunId: run.id,
            agentId: reviewer.id,
            metadata: { invoiceLineItem: 'line_1' },
          },
          {
            id: 'usage_1',
            occurredAt: new Date('2026-06-17T12:00:00.000Z'),
            amountUsd: 0.05,
            userId: user.id,
            repositoryId: repository.id,
            reviewRunId: target.reviewRunId,
            agentRunId: null,
            agentId: null,
          },
        ];
      },
    };

    await reconcile(testDatabase.db, client, review.id);
    await reconcile(testDatabase.db, client, review.id);

    expect(receivedTarget).toEqual({
      reviewRunId: review.id,
      userId: user.id,
      repositoryId: repository.id,
      startedAt: review.startedAt,
      finishedAt: review.finishedAt,
    });

    const rows = await testDatabase.db
      .select()
      .from(costEvent)
      .where(eq(costEvent.reviewRunId, review.id));

    expect(rows.map((row) => row.source).sort()).toEqual(['estimate', 'reconciled', 'reconciled']);
    expect(rows.find((row) => row.source === 'estimate')?.amountUsd).toBe('1.25000000');
    expect(rows.find((row) => row.source === 'estimate')?.repositoryId).toBe(repository.id);
    expect(
      rows
        .filter((row) => row.source === 'reconciled')
        .map((row) => row.amountUsd)
        .sort(),
    ).toEqual(['0.05000000', '1.10000000']);
  });

  it('throws when reconciling a review run that no longer exists', async () => {
    let costApiCalled = false;
    const client: UsageCostApiClient = {
      async listReviewRunCosts() {
        costApiCalled = true;
        return [];
      },
    };

    await expect(reconcile(testDatabase.db, client, 'missing_review_run')).rejects.toThrow(
      'Review run missing_review_run was not found for cost reconciliation.',
    );
    expect(costApiCalled).toBe(false);
  });

  it('reconciles legacy review runs without startedAt using the estimate window', async () => {
    const { user, repository, review, reviewer, run } = await createCostFixture();
    await testDatabase.db
      .update(tribunalRun)
      .set({ startedAt: null })
      .where(eq(tribunalRun.id, review.id));
    await recordLlmEstimate(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      reviewRunId: review.id,
      agentRunId: run.id,
      agentId: reviewer.id,
      amountUsd: 0.25,
      idempotencyKey: `llm:${run.id}:legacy-estimate`,
    });

    let receivedTarget: Parameters<UsageCostApiClient['listReviewRunCosts']>[0] | undefined;
    const client: UsageCostApiClient = {
      async listReviewRunCosts(target) {
        receivedTarget = target;
        return [
          {
            id: 'usage_legacy',
            occurredAt: new Date('2026-06-17T12:02:00.000Z'),
            amountUsd: 0.2,
            userId: user.id,
            repositoryId: repository.id,
            reviewRunId: target.reviewRunId,
            agentRunId: run.id,
            agentId: reviewer.id,
          },
        ];
      },
    };

    await reconcile(testDatabase.db, client, review.id);

    expect(receivedTarget).toEqual({
      reviewRunId: review.id,
      userId: user.id,
      repositoryId: repository.id,
      startedAt: expect.any(Date),
      finishedAt: review.finishedAt,
    });
    expect(receivedTarget?.startedAt).toEqual(expect.any(Date));
  });

  it('reconciles with a one-hour fallback window when the run start is not before finish', async () => {
    const { review } = await createCostFixture();
    await testDatabase.db
      .update(tribunalRun)
      .set({
        startedAt: new Date('2026-06-17T12:30:00.000Z'),
        finishedAt: new Date('2026-06-17T12:30:00.000Z'),
      })
      .where(eq(tribunalRun.id, review.id));
    let receivedTarget: Parameters<UsageCostApiClient['listReviewRunCosts']>[0] | undefined;
    const client: UsageCostApiClient = {
      async listReviewRunCosts(target) {
        receivedTarget = target;
        return [];
      },
    };

    await reconcile(testDatabase.db, client, review.id);

    expect(receivedTarget?.startedAt).toEqual(new Date('2026-06-17T11:30:00.000Z'));
    expect(receivedTarget?.finishedAt).toEqual(new Date('2026-06-17T12:30:00.000Z'));
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

  it('returns estimate, reconciled, and delta for a review run', async () => {
    const { user, review, reviewer, run } = await createCostFixture();
    await testDatabase.db.insert(costEvent).values([
      {
        id: 'cost_estimate',
        userId: user.id,
        kind: 'llm',
        source: 'estimate',
        reviewRunId: review.id,
        agentRunId: run.id,
        agentId: reviewer.id,
        amountUsd: '1.25',
        idempotencyKey: 'llm:estimate',
      },
      {
        id: 'cost_reconciled',
        userId: user.id,
        kind: 'llm',
        source: 'reconciled',
        reviewRunId: review.id,
        agentRunId: run.id,
        agentId: reviewer.id,
        amountUsd: '1.10',
        idempotencyKey: 'llm:reconciled',
      },
    ]);

    await expect(getReviewRunCostComparison(testDatabase.db, review.id)).resolves.toEqual({
      reviewRunId: review.id,
      estimateUsd: 1.25,
      reconciledUsd: 1.1,
      deltaUsd: -0.15,
    });
  });

  it('creates the review-core cost port over the ledger', async () => {
    const { user, repository, review, reviewer, run } = await createCostFixture();
    const client: UsageCostApiClient = {
      async listReviewRunCosts(target) {
        return [
          {
            id: 'usage_1',
            occurredAt: new Date('2026-06-17T12:00:00.000Z'),
            amountUsd: 0.75,
            userId: user.id,
            repositoryId: repository.id,
            reviewRunId: target.reviewRunId,
            agentRunId: run.id,
            agentId: reviewer.id,
          },
        ];
      },
    };
    const port = createCostPort(testDatabase.db, {
      usageCostApiClient: client,
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
    await port.reconcile(review.id);

    await expect(getReviewRunCostComparison(testDatabase.db, review.id)).resolves.toMatchObject({
      estimateUsd: 1,
      reconciledUsd: 0.75,
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
      usageCostApiClient: { listReviewRunCosts: async () => [] },
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
      usageCostApiClient: { listReviewRunCosts: async () => [] },
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
      usageCostApiClient: { listReviewRunCosts: async () => [] },
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
