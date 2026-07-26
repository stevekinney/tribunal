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

type CostDatabase = Pick<Database, 'execute' | 'select'>;

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
        delta.user_id,
        delta.day_started_at,
        SUM(delta.spent_delta_usd)::numeric AS spent_delta_usd,
        SUM(delta.released_delta_usd)::numeric AS released_delta_usd
      FROM (
        SELECT
          ${event.userId}::integer AS user_id,
          (SELECT day_started_at FROM event_day) AS day_started_at,
          COALESCE((SELECT SUM("amount_usd") FROM inserted_event), 0)::numeric AS spent_delta_usd,
          0::numeric AS released_delta_usd
        UNION ALL
        SELECT
          released_reservation.user_id,
          released_reservation.day_started_at,
          0::numeric AS spent_delta_usd,
          SUM(released_reservation.amount_usd)::numeric AS released_delta_usd
        FROM released_reservation
        GROUP BY released_reservation.user_id, released_reservation.day_started_at
      ) AS delta
      GROUP BY delta.user_id, delta.day_started_at
      HAVING SUM(delta.spent_delta_usd) > 0
          OR SUM(delta.released_delta_usd) > 0
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
      budget_delta.spent_delta_usd,
      0::numeric,
      ${eventOccurredAt},
      ${eventOccurredAt}
    FROM budget_delta
    ON CONFLICT ("user_id", "day_started_at") DO UPDATE SET
      "spent_usd" = ${costBudgetDay.spentUsd} + EXCLUDED."spent_usd",
      "reserved_usd" = GREATEST(
        ${costBudgetDay.reservedUsd} - (
          SELECT budget_delta.released_delta_usd
          FROM budget_delta
          WHERE budget_delta.user_id = EXCLUDED."user_id"
            AND budget_delta.day_started_at = EXCLUDED."day_started_at"
        ),
        0
      ),
      "updated_at" = ${eventOccurredAt}
  `);
}

async function recordSandboxEstimateEvent(
  database: CostDatabase,
  values: typeof costEvent.$inferInsert,
  amountUsd: number,
  occurredAt: Date,
): Promise<void> {
  await database.execute(sql`
    WITH event_day AS (
      SELECT ${dayStartedAtSql(occurredAt)} AS day_started_at
    ),
    inserted_event AS (
      INSERT INTO ${costEvent} (
        "id",
        "user_id",
        "kind",
        "source",
        "repository_id",
        "review_run_id",
        "amount_usd",
        "meta",
        "occurred_at",
        "idempotency_key"
      )
      VALUES (
        ${values.id},
        ${values.userId},
        'sandbox',
        'estimate',
        ${values.repositoryId},
        ${values.reviewRunId},
        ${numericText(amountUsd)}::numeric,
        ${JSON.stringify(values.meta ?? {})}::jsonb,
        ${occurredAt},
        ${values.idempotencyKey}
      )
      ON CONFLICT ("idempotency_key") DO NOTHING
      RETURNING "user_id", "amount_usd"
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
      ${values.userId},
      (SELECT day_started_at FROM event_day),
      COALESCE((SELECT SUM("amount_usd") FROM inserted_event), 0)::numeric,
      0::numeric,
      ${occurredAt},
      ${occurredAt}
    WHERE EXISTS (SELECT 1 FROM inserted_event)
    ON CONFLICT ("user_id", "day_started_at") DO UPDATE SET
      "spent_usd" = ${costBudgetDay.spentUsd} + EXCLUDED."spent_usd",
      "updated_at" = ${occurredAt}
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
  const occurredAt = input.occurredAt ?? new Date();
  await recordSandboxEstimateEvent(
    database,
    {
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
      occurredAt,
      idempotencyKey: `sandbox:${input.sandboxId}:${input.window}`,
    },
    amountUsd,
    occurredAt,
  );
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
  if (
    reservation.amountUsd !== undefined &&
    (!Number.isFinite(reservation.amountUsd) || reservation.amountUsd <= 0)
  ) {
    throw new Error('Daily cap reservation amount must be a positive finite number.');
  }
  if (reservation.expiresAt.getTime() <= now.getTime()) {
    throw new Error('Daily cap reservation expiry must be after the reservation time.');
  }

  const reservationAmountUsd =
    reservation.amountUsd === undefined ? null : numericText(reservation.amountUsd);
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
      released_expired_reservation AS (
        UPDATE ${costReservation}
        SET
          "released_at" = ${now},
          "updated_at" = ${now}
        FROM locked_budget
        WHERE ${costReservation.userId} = locked_budget.user_id
          AND ${costReservation.dayStartedAt} = locked_budget.day_started_at
          AND ${costReservation.releasedAt} IS NULL
          AND ${costReservation.expiresAt} <= ${now}
        RETURNING ${costReservation.id}
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
          GREATEST(
            cap.cap_usd
              - locked_budget.spent_usd
              - GREATEST(locked_budget.reserved_usd - expired_reservation.amount_usd, 0),
            0
          ) AS remaining_usd,
          COALESCE(
            ${reservationAmountUsd}::numeric,
            GREATEST(
              cap.cap_usd
                - locked_budget.spent_usd
                - GREATEST(locked_budget.reserved_usd - expired_reservation.amount_usd, 0),
              0
            )
          ) AS requested_usd
        FROM cap, locked_budget, expired_reservation
      ),
      claimed_reservation AS (
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
          claim_decision.requested_usd,
          ${reservation.expiresAt},
          ${now},
          ${now}
        FROM claim_decision
        WHERE NOT claim_decision.existing_active
          AND claim_decision.requested_usd > 0
          AND claim_decision.requested_usd <= claim_decision.remaining_usd
          AND (SELECT COUNT(*) FROM released_expired_reservation) >= 0
        ON CONFLICT DO NOTHING
        RETURNING ${costReservation.id}, ${costReservation.amountUsd}
      ),
      updated_budget AS (
        UPDATE ${costBudgetDay}
        SET
          "reserved_usd" = claim_decision.reserved_usd
            + COALESCE((SELECT SUM(amount_usd) FROM claimed_reservation), 0),
          "updated_at" = ${now}
        FROM claim_decision
        WHERE ${costBudgetDay.userId} = ${userId}
          AND ${costBudgetDay.dayStartedAt} = (SELECT day_started_at FROM budget_day)
        RETURNING
          (
            claim_decision.existing_active
            OR EXISTS (SELECT 1 FROM claimed_reservation)
          ) AS allowed,
          claim_decision.cap_usd AS cap_usd,
          claim_decision.spent_usd AS spent_usd,
          claim_decision.reserved_usd AS reserved_usd,
          claim_decision.remaining_usd AS remaining_usd
      )
      SELECT
        updated_budget.allowed AS "allowed",
        updated_budget.cap_usd AS "capUsd",
        updated_budget.spent_usd + updated_budget.reserved_usd AS "spendUsd",
        updated_budget.remaining_usd AS "remainingUsd"
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
    recordSandbox: async (event) => {
      const occurredAt = parseSandboxWindowStartedAt(event.window) ?? options.now?.() ?? new Date();
      await recordSandboxEstimateEvent(
        database,
        {
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
          occurredAt,
          idempotencyKey: event.idempotencyKey,
        },
        event.amountUsd,
        occurredAt,
      );
    },
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
