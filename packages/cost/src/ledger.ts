import { randomUUID } from 'node:crypto';
import type { Database } from '@tribunal/database';
import { and, eq, sql } from '@tribunal/database/operators';
import { costEvent, reviewRun, userReviewSettings } from '@tribunal/database/schema';
import { spendTodayEstimate as readSpendTodayEstimate } from '@tribunal/database/queries';
import type { CostPort, DailyCapDecision, LlmEstimateInput } from '@tribunal/review-core/ports';
import {
  CURRENT_PRICING_VERSION,
  sandboxCost,
  type SandboxResources,
  type SandboxRuntime,
} from './pricing';
import type { UsageCostApiClient, UsageCostApiEvent } from './usage-cost-api';

type CostDatabase = Pick<Database, 'insert' | 'select'>;

const defaultReconciliationLookbackMilliseconds = 60 * 60 * 1000;

export type RecordSandboxInput = {
  userId: number;
  repositoryId: number;
  reviewRunId: string;
  sandboxId: string;
  window: string;
  runtime: SandboxRuntime;
  resources: SandboxResources;
  occurredAt?: Date;
};

export type ReviewRunCostComparison = {
  reviewRunId: string;
  estimateUsd: number;
  reconciledUsd: number;
  deltaUsd: number;
};

function createCostEventId(): string {
  return `cost_${randomUUID()}`;
}

function numericText(value: number): string {
  return value.toFixed(8);
}

function toNumber(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

async function insertCostEvent(
  database: CostDatabase,
  values: typeof costEvent.$inferInsert,
): Promise<void> {
  await database
    .insert(costEvent)
    .values(values)
    .onConflictDoNothing({ target: costEvent.idempotencyKey });
}

/**
 * Records one LLM estimate event idempotently.
 */
export async function recordLlmEstimate(
  database: CostDatabase,
  event: LlmEstimateInput,
): Promise<void> {
  await insertCostEvent(database, {
    id: createCostEventId(),
    userId: event.userId,
    kind: 'llm',
    source: 'estimate',
    repositoryId: event.repositoryId,
    reviewRunId: event.reviewRunId,
    agentRunId: event.agentRunId,
    agentId: event.agentId,
    amountUsd: numericText(event.amountUsd),
    idempotencyKey: event.idempotencyKey,
  });
}

/**
 * Records one sandbox estimate event idempotently by sandbox billing window.
 */
export async function recordSandbox(
  database: CostDatabase,
  input: RecordSandboxInput,
): Promise<void> {
  const amountUsd = sandboxCost(input.runtime, input.resources);
  await insertCostEvent(database, {
    id: createCostEventId(),
    userId: input.userId,
    kind: 'sandbox',
    source: 'estimate',
    repositoryId: input.repositoryId,
    reviewRunId: input.reviewRunId,
    amountUsd: numericText(amountUsd),
    meta: {
      pricingVersion: CURRENT_PRICING_VERSION,
      runtime: input.runtime,
      resources: input.resources,
      sandboxId: input.sandboxId,
      window: input.window,
    },
    occurredAt: input.occurredAt,
    idempotencyKey: `sandbox:${input.sandboxId}:${input.window}`,
  });
}

function reconcileIdempotencyKey(event: UsageCostApiEvent): string {
  return `llm:${event.agentRunId ?? event.id}:reconciled`;
}

/**
 * Writes authoritative Usage and Cost API rows while preserving estimate rows.
 */
export async function reconcile(
  database: CostDatabase,
  usageCostApiClient: UsageCostApiClient,
  reviewRunId: string,
): Promise<void> {
  const [target] = await database
    .select({
      reviewRunId: reviewRun.id,
      userId: reviewRun.userId,
      repositoryId: reviewRun.repositoryId,
      startedAt: reviewRun.startedAt,
      finishedAt: reviewRun.finishedAt,
    })
    .from(reviewRun)
    .where(eq(reviewRun.id, reviewRunId));

  if (target === undefined) {
    throw new Error(`Review run ${reviewRunId} was not found for cost reconciliation.`);
  }

  const fallbackStartedAt =
    target.startedAt ?? (await readReviewRunEstimateStartedAt(database, reviewRunId));
  const finishedAt = target.finishedAt ?? new Date();
  const startedAt = resolveReconciliationStartedAt(fallbackStartedAt, finishedAt);

  const events = await usageCostApiClient.listReviewRunCosts({
    reviewRunId: target.reviewRunId,
    userId: target.userId,
    repositoryId: target.repositoryId,
    startedAt,
    finishedAt,
  });
  const orderedEvents = [...events].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );

  for (const event of orderedEvents) {
    await insertCostEvent(database, {
      id: createCostEventId(),
      userId: event.userId,
      kind: 'llm',
      source: 'reconciled',
      repositoryId: event.repositoryId,
      reviewRunId: event.reviewRunId,
      agentRunId: event.agentRunId,
      agentId: event.agentId,
      amountUsd: numericText(event.amountUsd),
      meta: event.metadata ?? {},
      occurredAt: event.occurredAt,
      idempotencyKey: reconcileIdempotencyKey(event),
    });
  }
}

async function readReviewRunEstimateStartedAt(
  database: CostDatabase,
  reviewRunId: string,
): Promise<Date | null> {
  const [row] = await database
    .select({ startedAt: sql<Date | string | null>`min(${costEvent.occurredAt})` })
    .from(costEvent)
    .where(and(eq(costEvent.reviewRunId, reviewRunId), eq(costEvent.source, 'estimate')));

  return toDate(row?.startedAt);
}

function resolveReconciliationStartedAt(startedAt: Date | null, finishedAt: Date): Date {
  if (startedAt !== null && startedAt.getTime() < finishedAt.getTime()) return startedAt;
  return new Date(finishedAt.getTime() - defaultReconciliationLookbackMilliseconds);
}

function parseSandboxWindowStartedAt(window: string): Date | undefined {
  const normalizedWindow = /^\d{4}-\d{2}-\d{2}T\d{2}$/u.test(window)
    ? `${window}:00:00.000Z`
    : window;
  const startedAt = new Date(normalizedWindow);
  return Number.isNaN(startedAt.getTime()) ? undefined : startedAt;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function readDailyCostCap(
  database: CostDatabase,
  userId: number,
  defaultDailyCostCapUsd: number,
): Promise<number> {
  const [settings] = await database
    .select({ dailyCostCapUsd: userReviewSettings.dailyCostCapUsd })
    .from(userReviewSettings)
    .where(eq(userReviewSettings.userId, userId));

  return toNumber(settings?.dailyCostCapUsd ?? defaultDailyCostCapUsd);
}

/**
 * Checks the live daily guard against estimate rows only.
 */
export async function enforceDailyCap(
  database: CostDatabase,
  userId: number,
  now = new Date(),
  defaultDailyCostCapUsd = 25,
): Promise<DailyCapDecision> {
  const [capUsd, spendUsd] = await Promise.all([
    readDailyCostCap(database, userId, defaultDailyCostCapUsd),
    readSpendTodayEstimate(database as Database, userId, now),
  ]);

  return {
    allowed: spendUsd < capUsd,
    capUsd,
    spendUsd,
    remainingUsd: Math.max(0, capUsd - spendUsd),
  };
}

/**
 * Returns estimate, reconciled, and delta totals for one review run.
 */
export async function getReviewRunCostComparison(
  database: CostDatabase,
  reviewRunId: string,
): Promise<ReviewRunCostComparison> {
  const [row] = await database
    .select({
      estimateUsd: sql<string>`coalesce(sum(${costEvent.amountUsd}) filter (where ${costEvent.source} = 'estimate'), 0)`,
      reconciledUsd: sql<string>`coalesce(sum(${costEvent.amountUsd}) filter (where ${costEvent.source} = 'reconciled'), 0)`,
    })
    .from(costEvent)
    .where(and(eq(costEvent.reviewRunId, reviewRunId)));

  const estimateUsd = toNumber(row?.estimateUsd);
  const reconciledUsd = toNumber(row?.reconciledUsd);

  return {
    reviewRunId,
    estimateUsd,
    reconciledUsd,
    deltaUsd: Number((reconciledUsd - estimateUsd).toFixed(8)),
  };
}

export type CreateCostPortOptions = {
  usageCostApiClient: UsageCostApiClient;
  now?: () => Date;
  defaultDailyCostCapUsd?: number;
};

/**
 * Creates the review engine cost port backed by the immutable cost ledger.
 */
export function createCostPort(database: CostDatabase, options: CreateCostPortOptions): CostPort {
  return {
    recordLlmEstimate: (event) =>
      insertCostEvent(database, {
        id: createCostEventId(),
        userId: event.userId,
        kind: 'llm',
        source: 'estimate',
        repositoryId: event.repositoryId,
        reviewRunId: event.reviewRunId,
        agentRunId: event.agentRunId,
        agentId: event.agentId,
        amountUsd: numericText(event.amountUsd),
        occurredAt: options.now?.(),
        idempotencyKey: event.idempotencyKey,
      }),
    recordSandbox: (event) =>
      insertCostEvent(database, {
        id: createCostEventId(),
        userId: event.userId,
        kind: 'sandbox',
        source: 'estimate',
        repositoryId: event.repositoryId,
        reviewRunId: event.reviewRunId,
        amountUsd: numericText(event.amountUsd),
        meta: {
          pricingVersion: event.pricingVersion ?? CURRENT_PRICING_VERSION,
          runtime: event.runtime,
          resources: event.resources,
          sandboxId: event.sandboxId,
          window: event.window,
        },
        occurredAt: parseSandboxWindowStartedAt(event.window) ?? options.now?.(),
        idempotencyKey: event.idempotencyKey,
      }),
    reconcile: (reviewRunId) => reconcile(database, options.usageCostApiClient, reviewRunId),
    enforceDailyCap: (userId) =>
      enforceDailyCap(
        database,
        userId,
        options.now?.() ?? new Date(),
        options.defaultDailyCostCapUsd ?? 25,
      ),
  };
}
