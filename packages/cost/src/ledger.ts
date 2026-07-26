import { randomUUID } from 'node:crypto';
import type { Database } from '@tribunal/database';
import { eq, sql } from '@tribunal/database/operators';
import { costEvent, userReviewSettings } from '@tribunal/database/schema';
import { spendTodayEstimate as readSpendTodayEstimate } from '@tribunal/database/queries';
import type {
  CostPort,
  DailyCapDecision,
  DailyCapReservationInput,
  LlmEstimateInput,
} from '@tribunal/review-core/ports';
import {
  CURRENT_PRICING_VERSION,
  sandboxCost,
  type SandboxResources,
  type SandboxRuntime,
} from './pricing';

type CostDatabase = Pick<Database, 'execute' | 'insert' | 'select'>;

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

function createDailyCapReservationIdempotencyKey(idempotencyKey: string): string {
  return `reservation:${idempotencyKey}`;
}

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

async function releaseDailyCapReservation(
  database: CostDatabase,
  idempotencyKey: string,
): Promise<void> {
  await database.execute(sql`
    DELETE FROM ${costEvent}
    WHERE ${costEvent.idempotencyKey} = ${createDailyCapReservationIdempotencyKey(idempotencyKey)}
      AND ${costEvent.source} = 'reservation'
  `);
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
  await releaseDailyCapReservation(database, event.idempotencyKey);
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
  reservation?: DailyCapReservationInput,
): Promise<DailyCapDecision> {
  if (reservation !== undefined) {
    return reserveDailyCap(database, userId, now, defaultDailyCostCapUsd, reservation);
  }

  const [capUsd, spendUsd] = await Promise.all([
    readDailyCostCap(database, userId, defaultDailyCostCapUsd),
    readSpendTodayEstimate(database as Database, userId, now),
  ]);

  return {
    allowed: spendUsd < capUsd,
  };
}

async function reserveDailyCap(
  database: CostDatabase,
  userId: number,
  now: Date,
  defaultDailyCostCapUsd: number,
  reservation: DailyCapReservationInput,
): Promise<DailyCapDecision> {
  if (!Number.isFinite(reservation.amountUsd) || reservation.amountUsd <= 0) {
    throw new Error('Daily cap reservation amount must be a positive finite number.');
  }

  const reservationIdempotencyKey = createDailyCapReservationIdempotencyKey(
    reservation.idempotencyKey,
  );
  const reservationMeta = { idempotencyKey: reservation.idempotencyKey };
  const reservationAmountUsd = numericText(reservation.amountUsd);
  const [row] = getRows<{
    allowed: boolean | string | null;
    capUsd: string | number | null;
    spendUsd: string | number | null;
    remainingUsd: string | number | null;
  }>(
    await database.execute(sql`
      WITH user_lock AS (
        SELECT pg_advisory_xact_lock(${userId}::integer)
      ),
      cap AS (
        SELECT COALESCE(
          (
            SELECT ${userReviewSettings.dailyCostCapUsd}
            FROM ${userReviewSettings}
            WHERE ${userReviewSettings.userId} = ${userId}
            LIMIT 1
          ),
          ${numericText(defaultDailyCostCapUsd)}::numeric
        ) AS cap_usd
        FROM user_lock
      ),
      day_window AS (
        SELECT
          date_trunc('day', ${now}::timestamptz) AS starts_at,
          date_trunc('day', ${now}::timestamptz) + interval '1 day' AS ends_at
      ),
      spend AS (
        SELECT COALESCE(SUM(${costEvent.amountUsd}), 0)::numeric AS spend_usd
        FROM ${costEvent}, day_window
        WHERE ${costEvent.userId} = ${userId}
          AND ${costEvent.source} IN ('estimate', 'reservation')
          AND ${costEvent.occurredAt} >= day_window.starts_at
          AND ${costEvent.occurredAt} < day_window.ends_at
      ),
      existing_reservation AS (
        SELECT ${costEvent.amountUsd}
        FROM ${costEvent}
        WHERE ${costEvent.userId} = ${userId}
          AND ${costEvent.source} = 'reservation'
          AND ${costEvent.idempotencyKey} = ${reservationIdempotencyKey}
        LIMIT 1
      ),
      inserted_reservation AS (
        INSERT INTO ${costEvent} (
          "id",
          "user_id",
          "kind",
          "source",
          "amount_usd",
          "meta",
          "occurred_at",
          "idempotency_key"
        )
        SELECT
          ${createCostEventId()},
          ${userId},
          'llm',
          'reservation',
          ${reservationAmountUsd}::numeric,
          ${JSON.stringify(reservationMeta)}::jsonb,
          ${now},
          ${reservationIdempotencyKey}
        FROM cap, spend
        WHERE NOT EXISTS (SELECT 1 FROM existing_reservation)
          AND spend.spend_usd + ${reservationAmountUsd}::numeric <= cap.cap_usd
        RETURNING ${costEvent.amountUsd}
      )
      SELECT
        (
          EXISTS (SELECT 1 FROM existing_reservation)
          OR EXISTS (SELECT 1 FROM inserted_reservation)
        ) AS "allowed",
        cap.cap_usd AS "capUsd",
        spend.spend_usd AS "spendUsd",
        GREATEST(cap.cap_usd - spend.spend_usd, 0) AS "remainingUsd"
      FROM cap, spend
    `),
  );

  const capUsd = toNumber(row?.capUsd ?? defaultDailyCostCapUsd);
  const spendUsd = toNumber(row?.spendUsd ?? 0);
  return {
    allowed: row?.allowed === true || row?.allowed === 'true',
    capUsd,
    spendUsd,
    remainingUsd: toNumber(row?.remainingUsd ?? Math.max(0, capUsd - spendUsd)),
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
    recordLlmEstimate: async (event) => {
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
        occurredAt: options.now?.(),
        idempotencyKey: event.idempotencyKey,
      });
      await releaseDailyCapReservation(database, event.idempotencyKey);
    },
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
          window: event.window,
        },
        occurredAt: parseSandboxWindowStartedAt(event.window) ?? options.now?.(),
        idempotencyKey: event.idempotencyKey,
      }),
    enforceDailyCap: (userId, reservation) =>
      enforceDailyCap(
        database,
        userId,
        options.now?.() ?? new Date(),
        options.defaultDailyCostCapUsd ?? 25,
        reservation,
      ),
  };
}
