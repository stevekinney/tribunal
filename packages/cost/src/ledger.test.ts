import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, resetIdCounter } from '@tribunal/test/factories';
import { eq, isNull, sql } from '@tribunal/database/operators';
import {
  agent,
  agentRun,
  costBudgetDay,
  costEvent,
  costReservation,
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

function numericTextForTest(value: number): string {
  return value.toFixed(8);
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
    expect(rows[0].meta).toMatchObject({
      pricingVersion: CURRENT_PRICING_VERSION,
      runtime: { runtimeSeconds: 60 },
      resources: { cpus: 2, memoryMb: 2048, storageMb: 10_240 },
      sandboxId: 'sandbox_1',
      window: '2026-06-17T10',
    });
  });

  // Per-run cost reconciliation was removed (see #215): the Anthropic cost
  // report endpoint only supports daily buckets grouped by description or
  // workspace_id — it has no run, request, or credential dimension — so a
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
      window: '2026-06-17T12:00:00.000Z',
      amountUsd: 0.2,
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
      window: '2026-06-17T12:00:00.000Z',
      amountUsd: 0.2,
      idempotencyKey: 'sandbox:sandbox_1:manual',
    });

    await expect(port.enforceDailyCap(user.id)).resolves.toEqual({ allowed: true });
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
      window: '2026-06-17T08',
      amountUsd: 0.2,
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

    await expect(port.enforceDailyCap(user.id)).resolves.toEqual({ allowed: false });
  });

  it('counts the first LLM estimate of the day against later reservations', async () => {
    const { user, repository, review, reviewer, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '0.01' });
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });

    await port.recordLlmEstimate({
      userId: user.id,
      repositoryId: repository.id,
      reviewRunId: review.id,
      agentRunId: run.id,
      agentId: reviewer.id,
      amountUsd: 0.01,
      idempotencyKey: `llm:${run.id}:estimate`,
    });

    await expect(
      port.enforceDailyCap(user.id, {
        idempotencyKey: `llm:${run.id}:next-estimate`,
        amountUsd: 0.01,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ allowed: false, spendUsd: 0.01, remainingUsd: 0 });
    const [budget] = await testDatabase.db.select().from(costBudgetDay);
    expect(Number(budget?.spentUsd)).toBe(0.01);
    expect(Number(budget?.reservedUsd)).toBe(0);
  });

  it('counts the first sandbox estimate of the day against later reservations', async () => {
    const { user, repository, review, run } = await createCostFixture();
    const runtime = { runtimeSeconds: 60 };
    const resources = { cpus: 2, memoryMb: 2048, storageMb: 10_240 };
    const amountUsd = sandboxCost(runtime, resources);
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: numericTextForTest(amountUsd) });

    await recordSandbox(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      reviewRunId: review.id,
      sandboxId: 'sandbox_first_spend',
      window: '2026-06-17T12',
      runtime,
      resources,
      occurredAt: new Date('2026-06-17T12:00:00.000Z'),
    });
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:30:00.000Z'),
    });

    await expect(
      port.enforceDailyCap(user.id, {
        idempotencyKey: `llm:${run.id}:after-sandbox-estimate`,
        amountUsd: 0.01,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ allowed: false, spendUsd: amountUsd, remainingUsd: 0 });
    const [budget] = await testDatabase.db.select().from(costBudgetDay);
    expect(Number(budget?.spentUsd)).toBe(amountUsd);
    expect(Number(budget?.reservedUsd)).toBe(0);
  });

  it('atomically reserves the remaining daily cap for only one concurrent same-user run', async () => {
    const { user, repository, review, reviewer, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '0.01' });
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });
    const reservations = [
      {
        idempotencyKey: `llm:${run.id}:first-estimate`,
        amountUsd: 0.01,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      },
      {
        idempotencyKey: `llm:${run.id}:second-estimate`,
        amountUsd: 0.01,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      },
    ];

    const decisions = await Promise.all(
      reservations.map(async (reservation) => ({
        reservation,
        decision: await port.enforceDailyCap(user.id, reservation),
      })),
    );

    const allowedDecisions = decisions.filter(({ decision }) => decision.allowed);
    expect(allowedDecisions).toHaveLength(1);
    expect(decisions.filter(({ decision }) => !decision.allowed)).toHaveLength(1);
    const rows = await testDatabase.db
      .select()
      .from(costReservation)
      .where(isNull(costReservation.releasedAt));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.amountUsd)).toBe(0.01);

    const allowedReservation = allowedDecisions[0]!.reservation;
    const estimate = {
      userId: user.id,
      repositoryId: repository.id,
      reviewRunId: review.id,
      agentRunId: run.id,
      agentId: reviewer.id,
      amountUsd: 0.01,
      idempotencyKey: allowedReservation.idempotencyKey,
    };
    await port.recordLlmEstimate(estimate);
    await port.recordLlmEstimate(estimate);

    const remainingReservations = await testDatabase.db
      .select()
      .from(costReservation)
      .where(isNull(costReservation.releasedAt));
    expect(remainingReservations).toHaveLength(0);
    const [budget] = await testDatabase.db.select().from(costBudgetDay);
    expect(Number(budget?.spentUsd)).toBe(0.01);
    expect(Number(budget?.reservedUsd)).toBe(0);
    await expect(port.enforceDailyCap(user.id)).resolves.toMatchObject({ allowed: false });
  });

  it('treats duplicate reservation idempotency keys as a single active reservation', async () => {
    const { user, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '0.02' });
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });
    const reservation = {
      idempotencyKey: `llm:${run.id}:estimate`,
      amountUsd: 0.01,
      expiresAt: new Date('2026-06-17T13:00:00.000Z'),
    };

    await expect(port.enforceDailyCap(user.id, reservation)).resolves.toMatchObject({
      allowed: true,
      spendUsd: 0,
      remainingUsd: 0.02,
    });
    await expect(port.enforceDailyCap(user.id, reservation)).resolves.toMatchObject({
      allowed: true,
      spendUsd: 0.01,
      remainingUsd: 0.01,
    });

    const reservations = await testDatabase.db.select().from(costReservation);
    const [budget] = await testDatabase.db.select().from(costBudgetDay);
    expect(reservations).toHaveLength(1);
    expect(Number(budget?.reservedUsd)).toBe(0.01);
  });

  it('extends an active idempotent reservation when a retry is admitted', async () => {
    const { user, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '0.02' });
    const portAtNoon = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });
    const reservation = {
      idempotencyKey: `llm:${run.id}:retry-estimate`,
      amountUsd: 0.01,
      expiresAt: new Date('2026-06-17T12:05:00.000Z'),
    };

    await expect(portAtNoon.enforceDailyCap(user.id, reservation)).resolves.toMatchObject({
      allowed: true,
    });

    const portBeforeExpiry = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:04:00.000Z'),
    });
    await expect(
      portBeforeExpiry.enforceDailyCap(user.id, {
        ...reservation,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      allowed: true,
    });

    const [activeReservation] = await testDatabase.db.select().from(costReservation);
    const [budget] = await testDatabase.db.select().from(costBudgetDay);
    expect(activeReservation?.expiresAt).toEqual(new Date('2026-06-17T13:00:00.000Z'));
    expect(Number(budget?.reservedUsd)).toBe(0.01);
  });

  it('resizes an active idempotent reservation when a retry is admitted', async () => {
    const { user, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '0.05' });
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });
    const reservation = {
      idempotencyKey: `llm:${run.id}:resized-estimate`,
      amountUsd: 0.01,
      expiresAt: new Date('2026-06-17T12:05:00.000Z'),
    };

    await expect(port.enforceDailyCap(user.id, reservation)).resolves.toMatchObject({
      allowed: true,
      spendUsd: 0,
      remainingUsd: 0.05,
    });
    await expect(
      port.enforceDailyCap(user.id, {
        ...reservation,
        amountUsd: 0.05,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      allowed: true,
      spendUsd: 0.01,
      remainingUsd: 0.04,
    });

    const [activeReservation] = await testDatabase.db.select().from(costReservation);
    const [budget] = await testDatabase.db.select().from(costBudgetDay);
    expect(Number(activeReservation?.amountUsd)).toBe(0.05);
    expect(activeReservation?.expiresAt).toEqual(new Date('2026-06-17T13:00:00.000Z'));
    expect(Number(budget?.reservedUsd)).toBe(0.05);
  });

  it('denies an idempotent reservation resize when the extra amount no longer fits', async () => {
    const { user, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '0.05' });
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });
    const reservation = {
      idempotencyKey: `llm:${run.id}:oversized-retry-estimate`,
      amountUsd: 0.01,
      expiresAt: new Date('2026-06-17T12:05:00.000Z'),
    };
    await port.enforceDailyCap(user.id, reservation);
    await testDatabase.db.insert(costEvent).values({
      id: 'cost_retry_resize_spend',
      userId: user.id,
      kind: 'sandbox',
      source: 'estimate',
      amountUsd: '0.02',
      idempotencyKey: 'sandbox:retry-resize-spend',
      occurredAt: new Date('2026-06-17T12:01:00.000Z'),
    });

    await expect(
      port.enforceDailyCap(user.id, {
        ...reservation,
        amountUsd: 0.05,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      allowed: false,
      spendUsd: 0.03,
      remainingUsd: 0.02,
    });

    const [activeReservation] = await testDatabase.db.select().from(costReservation);
    const [budget] = await testDatabase.db.select().from(costBudgetDay);
    expect(Number(activeReservation?.amountUsd)).toBe(0.01);
    expect(activeReservation?.expiresAt).toEqual(new Date('2026-06-17T12:05:00.000Z'));
    expect(Number(budget?.reservedUsd)).toBe(0.01);
  });

  it('expires stale unmatched reservations before checking the next reservation', async () => {
    const { user, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '0.01' });
    const portAtNoon = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });
    await expect(
      portAtNoon.enforceDailyCap(user.id, {
        idempotencyKey: `llm:${run.id}:stale-estimate`,
        amountUsd: 0.01,
        expiresAt: new Date('2026-06-17T12:05:00.000Z'),
      }),
    ).resolves.toMatchObject({ allowed: true });

    const portAfterExpiry = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:06:00.000Z'),
    });
    await expect(
      portAfterExpiry.enforceDailyCap(user.id, {
        idempotencyKey: `llm:${run.id}:replacement-estimate`,
        amountUsd: 0.01,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ allowed: true, spendUsd: 0, remainingUsd: 0.01 });

    const [budget] = await testDatabase.db.select().from(costBudgetDay);
    const activeReservations = await testDatabase.db
      .select()
      .from(costReservation)
      .where(isNull(costReservation.releasedAt));
    expect(Number(budget?.reservedUsd)).toBe(0.01);
    expect(activeReservations).toHaveLength(1);
    expect(activeReservations[0]?.idempotencyKey).toBe(`llm:${run.id}:replacement-estimate`);
  });

  it('denies new reservations after a cap is lowered below active spend plus reservations', async () => {
    const { user, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '0.02' });
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });
    const firstReservation = {
      idempotencyKey: `llm:${run.id}:first-estimate`,
      amountUsd: 0.01,
      expiresAt: new Date('2026-06-17T13:00:00.000Z'),
    };
    await expect(port.enforceDailyCap(user.id, firstReservation)).resolves.toMatchObject({
      allowed: true,
    });
    await testDatabase.db
      .update(userReviewSettings)
      .set({ dailyCostCapUsd: '0.005' })
      .where(eq(userReviewSettings.userId, user.id));

    await expect(port.enforceDailyCap(user.id, firstReservation)).resolves.toMatchObject({
      allowed: true,
      capUsd: 0.005,
    });
    await expect(
      port.enforceDailyCap(user.id, {
        idempotencyKey: `llm:${run.id}:second-estimate`,
        amountUsd: 0.01,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      allowed: false,
      capUsd: 0.005,
      remainingUsd: 0,
    });
  });

  it('reserves the full remaining budget when reservation amount is omitted', async () => {
    const { user, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '0.03' });
    await testDatabase.db.insert(costEvent).values({
      id: 'cost_existing_estimate',
      userId: user.id,
      kind: 'llm',
      source: 'estimate',
      amountUsd: '0.02',
      idempotencyKey: 'llm:existing-estimate',
      occurredAt: new Date('2026-06-17T08:00:00.000Z'),
    });
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });

    await expect(
      port.enforceDailyCap(user.id, {
        idempotencyKey: `llm:${run.id}:remaining-estimate`,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ allowed: true, spendUsd: 0.02, remainingUsd: 0.01 });
    await expect(
      port.enforceDailyCap(user.id, {
        idempotencyKey: `llm:${run.id}:over-remaining-estimate`,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ allowed: false, spendUsd: 0.03, remainingUsd: 0 });

    const [reservation] = await testDatabase.db.select().from(costReservation);
    expect(Number(reservation?.amountUsd)).toBe(0.01);
  });

  it('anchors reservation budget days to UTC regardless of the database session time zone', async () => {
    const { user, review, reviewer, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '0.01' });
    await testDatabase.db.insert(costEvent).values({
      id: 'cost_utc_day_estimate',
      userId: user.id,
      kind: 'llm',
      source: 'estimate',
      reviewRunId: review.id,
      agentRunId: run.id,
      agentId: reviewer.id,
      amountUsd: '0.01',
      idempotencyKey: 'llm:utc-day-estimate',
      occurredAt: new Date('2026-06-17T02:00:00.000Z'),
    });
    await testDatabase.db.execute(sql`SET TIME ZONE 'America/Los_Angeles'`);
    try {
      const port = createCostPort(testDatabase.db, {
        now: () => new Date('2026-06-17T12:00:00.000Z'),
      });

      await expect(
        port.enforceDailyCap(user.id, {
          idempotencyKey: `llm:${run.id}:utc-day-reservation`,
          amountUsd: 0.01,
          expiresAt: new Date('2026-06-17T13:00:00.000Z'),
        }),
      ).resolves.toMatchObject({ allowed: false, spendUsd: 0.01, remainingUsd: 0 });
    } finally {
      await testDatabase.db.execute(sql`SET TIME ZONE 'UTC'`);
    }

    const [budget] = await testDatabase.db.select().from(costBudgetDay);
    expect(budget?.dayStartedAt).toEqual(new Date('2026-06-17T00:00:00.000Z'));
  });

  it('reconciles cached spend from estimate rows written before the reservation check', async () => {
    const { user, review, reviewer, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '0.02' });
    await testDatabase.db.insert(costBudgetDay).values({
      userId: user.id,
      dayStartedAt: new Date('2026-06-17T00:00:00.000Z'),
      spentUsd: '0.01',
      reservedUsd: '0',
    });
    await testDatabase.db.insert(costEvent).values({
      id: 'cost_after_cached_budget',
      userId: user.id,
      kind: 'llm',
      source: 'estimate',
      reviewRunId: review.id,
      agentRunId: run.id,
      agentId: reviewer.id,
      amountUsd: '0.02',
      idempotencyKey: 'llm:after-cached-budget',
      occurredAt: new Date('2026-06-17T08:00:00.000Z'),
    });
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });

    await expect(
      port.enforceDailyCap(user.id, {
        idempotencyKey: `llm:${run.id}:stale-cache-reservation`,
        amountUsd: 0.01,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ allowed: false, spendUsd: 0.02, remainingUsd: 0 });
    const [budget] = await testDatabase.db.select().from(costBudgetDay);
    expect(Number(budget?.spentUsd)).toBe(0.02);
  });

  it('does not treat an expired prior-day reservation as a current-day idempotent success', async () => {
    const { user, review, reviewer, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '0.01' });
    await testDatabase.db.insert(costBudgetDay).values([
      {
        userId: user.id,
        dayStartedAt: new Date('2026-06-16T00:00:00.000Z'),
        spentUsd: '0',
        reservedUsd: '0.01',
      },
      {
        userId: user.id,
        dayStartedAt: new Date('2026-06-17T00:00:00.000Z'),
        spentUsd: '0.01',
        reservedUsd: '0',
      },
    ]);
    await testDatabase.db.insert(costReservation).values({
      id: 'cost_prior_day_reservation',
      userId: user.id,
      dayStartedAt: new Date('2026-06-16T00:00:00.000Z'),
      idempotencyKey: `llm:${run.id}:prior-day-reservation`,
      amountUsd: '0.01',
      expiresAt: new Date('2026-06-16T13:00:00.000Z'),
      createdAt: new Date('2026-06-16T12:00:00.000Z'),
      updatedAt: new Date('2026-06-16T12:00:00.000Z'),
    });
    await testDatabase.db.insert(costEvent).values({
      id: 'cost_today_exhausted',
      userId: user.id,
      kind: 'llm',
      source: 'estimate',
      reviewRunId: review.id,
      agentRunId: run.id,
      agentId: reviewer.id,
      amountUsd: '0.01',
      idempotencyKey: 'llm:today-exhausted',
      occurredAt: new Date('2026-06-17T08:00:00.000Z'),
    });
    const port = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });

    await expect(
      port.enforceDailyCap(user.id, {
        idempotencyKey: `llm:${run.id}:prior-day-reservation`,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ allowed: false, spendUsd: 0.01, remainingUsd: 0 });

    const activeReservations = await testDatabase.db
      .select()
      .from(costReservation)
      .where(isNull(costReservation.releasedAt));
    const budgets = await testDatabase.db.select().from(costBudgetDay);
    expect(activeReservations).toHaveLength(0);
    expect(
      Number(budgets.find((budget) => budget.dayStartedAt.getUTCDate() === 16)?.reservedUsd),
    ).toBe(0);
  });

  it('releases reservations from their own day when estimates arrive after UTC midnight', async () => {
    const { user, repository, review, reviewer, run } = await createCostFixture();
    await testDatabase.db
      .insert(userReviewSettings)
      .values({ userId: user.id, dailyCostCapUsd: '1.00' });
    const idempotencyKey = `llm:${run.id}:cross-midnight-estimate`;
    const beforeMidnightPort = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-17T23:59:00.000Z'),
    });
    await beforeMidnightPort.enforceDailyCap(user.id, {
      idempotencyKey,
      amountUsd: 0.25,
      expiresAt: new Date('2026-06-18T01:00:00.000Z'),
    });
    const afterMidnightPort = createCostPort(testDatabase.db, {
      now: () => new Date('2026-06-18T00:01:00.000Z'),
    });

    await afterMidnightPort.recordLlmEstimate({
      userId: user.id,
      repositoryId: repository.id,
      reviewRunId: review.id,
      agentRunId: run.id,
      agentId: reviewer.id,
      amountUsd: 0.05,
      idempotencyKey,
    });

    const budgets = await testDatabase.db.select().from(costBudgetDay);
    const reservationDay = budgets.find(
      (budget) => budget.dayStartedAt.getTime() === new Date('2026-06-17T00:00:00.000Z').getTime(),
    );
    const estimateDay = budgets.find(
      (budget) => budget.dayStartedAt.getTime() === new Date('2026-06-18T00:00:00.000Z').getTime(),
    );
    expect(Number(reservationDay?.reservedUsd)).toBe(0);
    expect(Number(reservationDay?.spentUsd)).toBe(0);
    expect(Number(estimateDay?.reservedUsd)).toBe(0);
    expect(Number(estimateDay?.spentUsd)).toBe(0.05);
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

    await expect(port.enforceDailyCap(user.id)).resolves.toEqual({ allowed: false });
  });

  it('rejects invalid daily cap reservation inputs before touching the ledger', async () => {
    const { user } = await createCostFixture();
    const now = new Date('2026-06-17T12:00:00.000Z');

    await expect(
      enforceDailyCap(testDatabase.db, user.id, now, 25, {
        idempotencyKey: 'llm:invalid-amount:estimate',
        amountUsd: 0,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).rejects.toThrow('Daily cap reservation amount must be a positive finite number.');
    await expect(
      enforceDailyCap(testDatabase.db, user.id, now, 25, {
        idempotencyKey: 'llm:expired:estimate',
        amountUsd: 0.01,
        expiresAt: now,
      }),
    ).rejects.toThrow('Daily cap reservation expiry must be after the reservation time.');
  });

  it('treats driver results without rows as a denied reservation decision', async () => {
    const database = {
      execute: async () => undefined,
      select: testDatabase.db.select,
    } as unknown as Parameters<typeof enforceDailyCap>[0];

    await expect(
      enforceDailyCap(database, 1, new Date('2026-06-17T12:00:00.000Z'), 25, {
        idempotencyKey: 'llm:empty-driver:estimate',
        amountUsd: 0.01,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).resolves.toEqual({ allowed: false, capUsd: 25, spendUsd: 0, remainingUsd: 25 });
  });

  it('treats an active same-key reservation as idempotent success when the claim result is empty', async () => {
    let executeCalls = 0;
    const database = {
      execute: async () => {
        executeCalls += 1;
        if (executeCalls === 2) {
          return {
            rows: [{ allowed: false, capUsd: '0.05', spendUsd: '0.01', remainingUsd: '0.04' }],
          };
        }
        if (executeCalls === 3) {
          return { rows: [{ id: 'cost_active_retry', amountUsd: '0.01' }] };
        }
        return undefined;
      },
      select: testDatabase.db.select,
    } as unknown as Parameters<typeof enforceDailyCap>[0];

    await expect(
      enforceDailyCap(database, 1, new Date('2026-06-17T12:00:00.000Z'), 25, {
        idempotencyKey: 'llm:active-driver-retry:estimate',
        amountUsd: 0.01,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      }),
    ).resolves.toEqual({ allowed: true, capUsd: 0.05, spendUsd: 0.01, remainingUsd: 0.04 });
  });
});
