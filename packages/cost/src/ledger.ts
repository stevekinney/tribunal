import { randomUUID } from 'node:crypto';
import type { Database } from '@tribunal/database';
import { eq } from '@tribunal/database/operators';
import { costEvent, userReviewSettings } from '@tribunal/database/schema';
import { spendTodayEstimate as readSpendTodayEstimate } from '@tribunal/database/queries';
import type { CostPort, DailyCapDecision, LlmEstimateInput } from '@tribunal/review-core/ports';
import {
  CURRENT_PRICING_VERSION,
  sandboxCost,
  type SandboxResources,
  type SandboxRuntime,
} from './pricing';

type CostDatabase = Pick<Database, 'insert' | 'select'>;

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

function parseSandboxWindowStartedAt(window: string): Date | undefined {
  const normalizedWindow = /^\d{4}-\d{2}-\d{2}T\d{2}$/u.test(window)
    ? `${window}:00:00.000Z`
    : window;
  const startedAt = new Date(normalizedWindow);
  return Number.isNaN(startedAt.getTime()) ? undefined : startedAt;
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

export type CreateCostPortOptions = {
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
    enforceDailyCap: (userId) =>
      enforceDailyCap(
        database,
        userId,
        options.now?.() ?? new Date(),
        options.defaultDailyCostCapUsd ?? 25,
      ),
  };
}
