import { randomUUID } from 'node:crypto';
import type { Database } from '@tribunal/database';
import { eq, sql } from '@tribunal/database/operators';
import {
  costBudgetDay,
  costEvent,
  costReservation,
  userReviewSettings,
} from '@tribunal/database/schema';
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

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function dayStartedAtSql(now: Date) {
  return sql<Date>`date_trunc('day', ${now}::timestamptz)`;
}

async function ensureDailyBudgetRow(
  database: CostDatabase,
  userId: number,
  now: Date,
): Promise<void> {
  await database.execute(sql`
    WITH budget_day AS (
      SELECT ${dayStartedAtSql(now)} AS day_started_at
    )
    INSERT INTO ${costBudgetDay} (
      "user_id",
      "day_started_at",
      "spent_usd",
      "reserved_usd",
      "created_at",
      "updated_at"
    )
    SELECT
      ${userId},
      budget_day.day_started_at,
      COALESCE((
        SELECT SUM(${costEvent.amountUsd})
        FROM ${costEvent}
        WHERE ${costEvent.userId} = ${userId}
          AND ${costEvent.source} = 'estimate'
          AND ${costEvent.occurredAt} >= budget_day.day_started_at
          AND ${costEvent.occurredAt} < budget_day.day_started_at + interval '1 day'
      ), 0)::numeric,
      0::numeric,
      ${now},
      ${now}
    FROM budget_day
    WHERE NOT EXISTS (
      SELECT 1
      FROM ${costBudgetDay}
      WHERE ${costBudgetDay.userId} = ${userId}
        AND ${costBudgetDay.dayStartedAt} = budget_day.day_started_at
    )
    ON CONFLICT ("user_id", "day_started_at") DO NOTHING
  `);
}

async function recordLlmEstimateEvent(
  database: CostDatabase,
  event: LlmEstimateInput,
  occurredAt?: Date,
): Promise<void> {
  const eventOccurredAt = occurredAt ?? new Date();
  const amountUsd = numericText(event.amountUsd);

  await database.execute(sql`
    WITH event_day AS (
      SELECT ${dayStartedAtSql(eventOccurredAt)} AS day_started_at
    ),
    inserted_event AS (
      INSERT INTO ${costEvent} (
        "id",
        "user_id",
        "kind",
        "source",
        "repository_id",
        "review_run_id",
        "agent_run_id",
        "agent_id",
        "amount_usd",
        "occurred_at",
        "idempotency_key"
      )
      VALUES (
        ${createCostEventId()},
        ${event.userId},
        'llm',
        'estimate',
        ${event.repositoryId},
        ${event.reviewRunId},
        ${event.agentRunId},
        ${event.agentId},
        ${amountUsd}::numeric,
        ${eventOccurredAt},
        ${event.idempotencyKey}
      )
      ON CONFLICT ("idempotency_key") DO NOTHING
      RETURNING "user_id", "amount_usd", "occurred_at"
    ),
    released_reservation AS (
      UPDATE ${costReservation}
      SET
        "released_at" = ${eventOccurredAt},
        "updated_at" = ${eventOccurredAt}
      WHERE ${costReservation.idempotencyKey} = ${event.idempotencyKey}
        AND ${costReservation.releasedAt} IS NULL
      RETURNING
        ${costReservation.userId} AS user_id,
        ${costReservation.dayStartedAt} AS day_started_at,
        ${costReservation.amountUsd} AS amount_usd
    ),
    budget_delta AS (
      SELECT
        ${event.userId}::integer AS user_id,
        (SELECT day_started_at FROM event_day) AS day_started_at,
        COALESCE((SELECT SUM("amount_usd") FROM inserted_event), 0)::numeric AS spent_delta_usd,
        COALESCE((SELECT SUM(amount_usd) FROM released_reservation), 0)::numeric AS released_delta_usd
    )
    INSERT INTO ${costBudgetDay} (
      "user_id",
      "day_started_at",
      "spent_usd",
      "reserved_usd",
      "created_at",
      "updated_at"
    )
    SELECT
      budget_delta.user_id,
      budget_delta.day_started_at,
      COALESCE((
        SELECT SUM(${costEvent.amountUsd})
        FROM ${costEvent}
        WHERE ${costEvent.userId} = budget_delta.user_id
          AND ${costEvent.source} = 'estimate'
          AND ${costEvent.occurredAt} >= budget_delta.day_started_at
          AND ${costEvent.occurredAt} < budget_delta.day_started_at + interval '1 day'
      ), 0)::numeric,
      0::numeric,
      ${eventOccurredAt},
      ${eventOccurredAt}
    FROM budget_delta
    WHERE budget_delta.spent_delta_usd > 0
       OR budget_delta.released_delta_usd > 0
    ON CONFLICT ("user_id", "day_started_at") DO UPDATE SET
      "spent_usd" = ${costBudgetDay.spentUsd} + (SELECT spent_delta_usd FROM budget_delta),
      "reserved_usd" = GREATEST(
        ${costBudgetDay.reservedUsd} - (SELECT released_delta_usd FROM budget_delta),
        0
      ),
      "updated_at" = ${eventOccurredAt}
  `);
}

/**
 * Records one LLM estimate event idempotently.
 */
export async function recordLlmEstimate(
  database: CostDatabase,
  event: LlmEstimateInput,
): Promise<void> {
  await recordLlmEstimateEvent(database, event);
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
  if (reservation.expiresAt.getTime() <= now.getTime()) {
    throw new Error('Daily cap reservation expiry must be after the reservation time.');
  }

  const reservationAmountUsd = numericText(reservation.amountUsd);
  await ensureDailyBudgetRow(database, userId, now);

  const [row] = getRows<{
    allowed: boolean | string | null;
    capUsd: string | number | null;
    spendUsd: string | number | null;
    remainingUsd: string | number | null;
  }>(
    await database.execute(sql`
      WITH cap AS (
        SELECT COALESCE(
          (
            SELECT ${userReviewSettings.dailyCostCapUsd}
            FROM ${userReviewSettings}
            WHERE ${userReviewSettings.userId} = ${userId}
            LIMIT 1
          ),
          ${numericText(defaultDailyCostCapUsd)}::numeric
        ) AS cap_usd
      ),
      budget_day AS (
        SELECT ${dayStartedAtSql(now)} AS day_started_at
      ),
      locked_budget AS (
        SELECT
          ${costBudgetDay.userId},
          ${costBudgetDay.dayStartedAt},
          ${costBudgetDay.spentUsd}::numeric AS spent_usd,
          ${costBudgetDay.reservedUsd}::numeric AS reserved_usd
        FROM ${costBudgetDay}
        WHERE ${costBudgetDay.userId} = ${userId}
          AND ${costBudgetDay.dayStartedAt} = (SELECT day_started_at FROM budget_day)
        FOR UPDATE OF ${costBudgetDay}
      ),
      expired_reservation AS (
        SELECT COALESCE(SUM(${costReservation.amountUsd}), 0)::numeric AS amount_usd
        FROM ${costReservation}, locked_budget
        WHERE ${costReservation.userId} = locked_budget.user_id
          AND ${costReservation.dayStartedAt} = locked_budget.day_started_at
          AND ${costReservation.releasedAt} IS NULL
          AND ${costReservation.expiresAt} <= ${now}
      ),
      existing_active_reservation AS (
        SELECT 1
        FROM ${costReservation}, locked_budget
        WHERE ${costReservation.userId} = locked_budget.user_id
          AND ${costReservation.idempotencyKey} = ${reservation.idempotencyKey}
          AND ${costReservation.releasedAt} IS NULL
          AND ${costReservation.expiresAt} > ${now}
        LIMIT 1
      ),
      claim_decision AS (
        SELECT
          cap.cap_usd,
          locked_budget.spent_usd,
          GREATEST(
            locked_budget.reserved_usd - expired_reservation.amount_usd,
            0
          ) AS reserved_usd,
          EXISTS (SELECT 1 FROM existing_active_reservation) AS existing_active,
          (
            locked_budget.spent_usd
              + GREATEST(locked_budget.reserved_usd - expired_reservation.amount_usd, 0)
              + ${reservationAmountUsd}::numeric
            <= cap.cap_usd
          ) AS claim_allowed
        FROM cap, locked_budget, expired_reservation
      ),
      updated_budget AS (
        UPDATE ${costBudgetDay}
        SET
          "reserved_usd" = claim_decision.reserved_usd
            + CASE
              WHEN claim_decision.existing_active THEN 0::numeric
              WHEN claim_decision.claim_allowed THEN ${reservationAmountUsd}::numeric
              ELSE 0::numeric
            END,
          "updated_at" = ${now}
        FROM claim_decision
        WHERE ${costBudgetDay.userId} = ${userId}
          AND ${costBudgetDay.dayStartedAt} = (SELECT day_started_at FROM budget_day)
        RETURNING
          (
            claim_decision.existing_active
            OR claim_decision.claim_allowed
          ) AS allowed,
          claim_decision.existing_active AS existing_active,
          claim_decision.cap_usd AS cap_usd,
          claim_decision.spent_usd AS spent_usd,
          claim_decision.reserved_usd AS reserved_usd
      ),
      released_expired_reservation AS (
        UPDATE ${costReservation}
        SET
          "released_at" = ${now},
          "updated_at" = ${now}
        FROM updated_budget
        WHERE ${costReservation.userId} = ${userId}
          AND ${costReservation.dayStartedAt} = (SELECT day_started_at FROM budget_day)
          AND ${costReservation.releasedAt} IS NULL
          AND ${costReservation.expiresAt} <= ${now}
        RETURNING ${costReservation.id}
      ),
      inserted_reservation AS (
        INSERT INTO ${costReservation} (
          "id",
          "user_id",
          "day_started_at",
          "idempotency_key",
          "amount_usd",
          "expires_at",
          "created_at",
          "updated_at"
        )
        SELECT
          ${createCostEventId()},
          ${userId},
          (SELECT day_started_at FROM budget_day),
          ${reservation.idempotencyKey},
          ${reservationAmountUsd}::numeric,
          ${reservation.expiresAt},
          ${now},
          ${now}
        FROM updated_budget
        WHERE updated_budget.allowed
          AND NOT updated_budget.existing_active
        ON CONFLICT DO NOTHING
        RETURNING ${costReservation.id}
      )
      SELECT
        updated_budget.allowed AS "allowed",
        updated_budget.cap_usd AS "capUsd",
        updated_budget.spent_usd + updated_budget.reserved_usd AS "spendUsd",
        GREATEST(updated_budget.cap_usd - updated_budget.spent_usd - updated_budget.reserved_usd, 0) AS "remainingUsd"
      FROM updated_budget
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
      await recordLlmEstimateEvent(database, event, options.now?.());
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
