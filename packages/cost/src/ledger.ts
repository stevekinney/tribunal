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

type LedgerDailyCapDecision = DailyCapDecision & {
  capUsd: number;
  spendUsd: number;
  remainingUsd: number;
};

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
  return sql<Date>`date_trunc('day', ${now}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
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
  await ensureDailyBudgetRow(database, event.userId, eventOccurredAt);

  await database.execute(sql`
    WITH event_day AS (
      SELECT ${dayStartedAtSql(eventOccurredAt)} AS day_started_at
    ),
    active_reservation_day AS (
      SELECT
        ${costReservation.userId} AS user_id,
        ${costReservation.dayStartedAt} AS day_started_at
      FROM ${costReservation}
      WHERE ${costReservation.idempotencyKey} = ${event.idempotencyKey}
        AND ${costReservation.releasedAt} IS NULL
      LIMIT 1
    ),
    budget_days AS (
      SELECT ${event.userId}::integer AS user_id, (SELECT day_started_at FROM event_day) AS day_started_at
      UNION
      SELECT active_reservation_day.user_id, active_reservation_day.day_started_at
      FROM active_reservation_day
    ),
    locked_budget AS (
      SELECT ${costBudgetDay.userId}, ${costBudgetDay.dayStartedAt}
      FROM ${costBudgetDay}
      INNER JOIN budget_days
        ON budget_days.user_id = ${costBudgetDay.userId}
        AND budget_days.day_started_at = ${costBudgetDay.dayStartedAt}
      ORDER BY ${costBudgetDay.userId}, ${costBudgetDay.dayStartedAt}
      FOR UPDATE OF ${costBudgetDay}
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
      SELECT
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
      FROM (SELECT COUNT(*) AS lock_count FROM locked_budget) AS lock_dependency
      WHERE lock_dependency.lock_count >= 1
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
        AND EXISTS (
          SELECT 1
          FROM locked_budget
          WHERE locked_budget.user_id = ${costReservation.userId}
            AND locked_budget.day_started_at = ${costReservation.dayStartedAt}
        )
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
    ),
    event_spend AS (
      SELECT
        budget_days.user_id,
        budget_days.day_started_at,
        COALESCE((
          SELECT SUM(${costEvent.amountUsd})
          FROM ${costEvent}
          WHERE ${costEvent.userId} = budget_days.user_id
            AND ${costEvent.source} = 'estimate'
            AND ${costEvent.occurredAt} >= budget_days.day_started_at
            AND ${costEvent.occurredAt} < budget_days.day_started_at + interval '1 day'
        ), 0)::numeric AS spent_usd
      FROM budget_days
    )
    UPDATE ${costBudgetDay}
    SET
      "spent_usd" = GREATEST(
        ${costBudgetDay.spentUsd},
        COALESCE((
          SELECT event_spend.spent_usd
          FROM event_spend
          WHERE event_spend.user_id = ${costBudgetDay.userId}
            AND event_spend.day_started_at = ${costBudgetDay.dayStartedAt}
        ), 0)
      ) + COALESCE((
        SELECT budget_delta.spent_delta_usd
        FROM budget_delta
        WHERE budget_delta.user_id = ${costBudgetDay.userId}
          AND budget_delta.day_started_at = ${costBudgetDay.dayStartedAt}
      ), 0),
      "reserved_usd" = GREATEST(
        ${costBudgetDay.reservedUsd} - COALESCE((
          SELECT budget_delta.released_delta_usd
          FROM budget_delta
          WHERE budget_delta.user_id = ${costBudgetDay.userId}
            AND budget_delta.day_started_at = ${costBudgetDay.dayStartedAt}
        ), 0),
        0
      ),
      "updated_at" = ${eventOccurredAt}
    WHERE EXISTS (
      SELECT 1
      FROM budget_days
      WHERE budget_days.user_id = ${costBudgetDay.userId}
        AND budget_days.day_started_at = ${costBudgetDay.dayStartedAt}
    )
  `);
}

async function recordSandboxEstimateEvent(
  database: CostDatabase,
  values: typeof costEvent.$inferInsert,
  amountUsd: number,
  occurredAt: Date,
): Promise<void> {
  await ensureDailyBudgetRow(database, values.userId, occurredAt);

  await database.execute(sql`
    WITH event_day AS (
      SELECT ${dayStartedAtSql(occurredAt)} AS day_started_at
    ),
    locked_budget AS (
      SELECT ${costBudgetDay.userId}, ${costBudgetDay.dayStartedAt}
      FROM ${costBudgetDay}
      WHERE ${costBudgetDay.userId} = ${values.userId}
        AND ${costBudgetDay.dayStartedAt} = (SELECT day_started_at FROM event_day)
      FOR UPDATE OF ${costBudgetDay}
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
      SELECT
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
      FROM locked_budget
      ON CONFLICT ("idempotency_key") DO NOTHING
      RETURNING "user_id", "amount_usd"
    ),
    event_spend AS (
      SELECT
        locked_budget.user_id,
        locked_budget.day_started_at,
        COALESCE(SUM(${costEvent.amountUsd}), 0)::numeric AS spent_usd
      FROM locked_budget
      LEFT JOIN ${costEvent}
        ON ${costEvent.userId} = locked_budget.user_id
        AND ${costEvent.source} = 'estimate'
        AND ${costEvent.occurredAt} >= locked_budget.day_started_at
        AND ${costEvent.occurredAt} < locked_budget.day_started_at + interval '1 day'
      GROUP BY locked_budget.user_id, locked_budget.day_started_at
    )
    UPDATE ${costBudgetDay}
    SET
      "spent_usd" = GREATEST(
        ${costBudgetDay.spentUsd},
        COALESCE((
          SELECT event_spend.spent_usd
          FROM event_spend
          WHERE event_spend.user_id = ${costBudgetDay.userId}
            AND event_spend.day_started_at = ${costBudgetDay.dayStartedAt}
        ), 0)
      ) + COALESCE((SELECT SUM("amount_usd") FROM inserted_event), 0)::numeric,
      "updated_at" = ${occurredAt}
    WHERE EXISTS (
      SELECT 1
      FROM locked_budget
      WHERE locked_budget.user_id = ${costBudgetDay.userId}
        AND locked_budget.day_started_at = ${costBudgetDay.dayStartedAt}
    )
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
): Promise<LedgerDailyCapDecision> {
  if (reservation !== undefined) {
    return reserveDailyCap(database, userId, now, defaultDailyCostCapUsd, reservation);
  }

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

async function reserveDailyCap(
  database: CostDatabase,
  userId: number,
  now: Date,
  defaultDailyCostCapUsd: number,
  reservation: DailyCapReservationInput,
): Promise<LedgerDailyCapDecision> {
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
      reservation_budget_days AS (
        SELECT ${userId}::integer AS user_id, (SELECT day_started_at FROM budget_day) AS day_started_at
        UNION
        SELECT ${costReservation.userId}, ${costReservation.dayStartedAt}
        FROM ${costReservation}
        WHERE ${costReservation.userId} = ${userId}
          AND ${costReservation.idempotencyKey} = ${reservation.idempotencyKey}
          AND ${costReservation.releasedAt} IS NULL
          AND ${costReservation.expiresAt} <= ${now}
      ),
      locked_budget AS (
        SELECT
          ${costBudgetDay.userId},
          ${costBudgetDay.dayStartedAt},
          ${costBudgetDay.spentUsd}::numeric AS spent_usd,
          ${costBudgetDay.reservedUsd}::numeric AS reserved_usd
        FROM ${costBudgetDay}
        INNER JOIN reservation_budget_days
          ON reservation_budget_days.user_id = ${costBudgetDay.userId}
          AND reservation_budget_days.day_started_at = ${costBudgetDay.dayStartedAt}
        ORDER BY ${costBudgetDay.userId}, ${costBudgetDay.dayStartedAt}
        FOR UPDATE OF ${costBudgetDay}
      ),
      event_spend AS (
        SELECT
          locked_budget.user_id,
          locked_budget.day_started_at,
          COALESCE(SUM(${costEvent.amountUsd}), 0)::numeric AS spent_usd
        FROM locked_budget
        LEFT JOIN ${costEvent}
          ON ${costEvent.userId} = locked_budget.user_id
          AND ${costEvent.source} = 'estimate'
          AND ${costEvent.occurredAt} >= locked_budget.day_started_at
          AND ${costEvent.occurredAt} < locked_budget.day_started_at + interval '1 day'
        GROUP BY locked_budget.user_id, locked_budget.day_started_at
      ),
      released_expired_reservation AS (
        UPDATE ${costReservation}
        SET
          "released_at" = ${now},
          "updated_at" = ${now}
        FROM locked_budget
        WHERE ${costReservation.userId} = locked_budget.user_id
          AND ${costReservation.releasedAt} IS NULL
          AND ${costReservation.expiresAt} <= ${now}
          AND (
            ${costReservation.dayStartedAt} = locked_budget.day_started_at
            OR ${costReservation.idempotencyKey} = ${reservation.idempotencyKey}
          )
        RETURNING
          ${costReservation.id},
          ${costReservation.userId} AS user_id,
          ${costReservation.dayStartedAt} AS day_started_at,
          ${costReservation.amountUsd} AS amount_usd
      ),
      released_expired_total AS (
        SELECT
          released_expired_reservation.user_id,
          released_expired_reservation.day_started_at,
          COALESCE(SUM(released_expired_reservation.amount_usd), 0)::numeric AS amount_usd
        FROM released_expired_reservation
        GROUP BY
          released_expired_reservation.user_id,
          released_expired_reservation.day_started_at
      ),
      reconciled_budget AS (
        SELECT
          locked_budget.user_id,
          locked_budget.day_started_at,
          GREATEST(
            locked_budget.spent_usd,
            COALESCE((
              SELECT event_spend.spent_usd
              FROM event_spend
              WHERE event_spend.user_id = locked_budget.user_id
                AND event_spend.day_started_at = locked_budget.day_started_at
            ), 0)
          ) AS spent_usd,
          GREATEST(
            locked_budget.reserved_usd - COALESCE((
              SELECT released_expired_total.amount_usd
              FROM released_expired_total
              WHERE released_expired_total.user_id = locked_budget.user_id
                AND released_expired_total.day_started_at = locked_budget.day_started_at
            ), 0),
            0
        ) AS reserved_usd
        FROM locked_budget
      ),
      active_idempotent_reservation AS (
        SELECT
          ${costReservation.id},
          ${costReservation.userId} AS user_id,
          ${costReservation.dayStartedAt} AS day_started_at,
          ${costReservation.amountUsd}::numeric AS amount_usd
        FROM ${costReservation}
        WHERE ${costReservation.userId} = ${userId}
          AND ${costReservation.dayStartedAt} = (SELECT day_started_at FROM budget_day)
          AND ${costReservation.idempotencyKey} = ${reservation.idempotencyKey}
          AND ${costReservation.releasedAt} IS NULL
          AND ${costReservation.expiresAt} > ${now}
        LIMIT 1
      ),
      claim_decision AS (
        SELECT
          cap.cap_usd,
          reconciled_budget.spent_usd,
          reconciled_budget.reserved_usd,
          GREATEST(
            cap.cap_usd
              - reconciled_budget.spent_usd
              - reconciled_budget.reserved_usd,
            0
          ) AS remaining_usd,
          COALESCE(
            ${reservationAmountUsd}::numeric,
            (
              SELECT active_idempotent_reservation.amount_usd
              FROM active_idempotent_reservation
            ),
            GREATEST(
              cap.cap_usd
                - reconciled_budget.spent_usd
                - reconciled_budget.reserved_usd,
              0
            )
          ) AS requested_usd,
          COALESCE((
            SELECT active_idempotent_reservation.amount_usd
            FROM active_idempotent_reservation
          ), 0)::numeric AS existing_reservation_usd
        FROM cap, reconciled_budget
        WHERE reconciled_budget.day_started_at = (SELECT day_started_at FROM budget_day)
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
        WHERE claim_decision.requested_usd > 0
          AND claim_decision.requested_usd
            <= claim_decision.remaining_usd + claim_decision.existing_reservation_usd
          AND (SELECT COUNT(*) FROM released_expired_reservation) >= 0
        ON CONFLICT ("idempotency_key") WHERE "released_at" IS NULL DO UPDATE SET
          "amount_usd" = EXCLUDED."amount_usd",
          "expires_at" = EXCLUDED."expires_at",
          "updated_at" = ${now}
        WHERE ${costReservation.userId} = ${userId}
          AND ${costReservation.dayStartedAt} = (SELECT day_started_at FROM budget_day)
          AND ${costReservation.expiresAt} > ${now}
        RETURNING
          ${costReservation.id},
          ${costReservation.amountUsd},
          (xmax = 0) AS inserted
      ),
      updated_budget AS (
        UPDATE ${costBudgetDay}
        SET
          "spent_usd" = reconciled_budget.spent_usd,
          "reserved_usd" = reconciled_budget.reserved_usd
            + CASE
                WHEN reconciled_budget.day_started_at = (SELECT day_started_at FROM budget_day)
                  THEN COALESCE((
                    SELECT SUM(amount_usd)
                    FROM claimed_reservation
                    WHERE inserted
                  ), 0)
                    + COALESCE((
                      SELECT SUM(amount_usd - claim_decision.existing_reservation_usd)
                      FROM claimed_reservation
                      WHERE NOT inserted
                    ), 0)
                ELSE 0
              END,
          "updated_at" = ${now}
        FROM reconciled_budget
        CROSS JOIN claim_decision
        WHERE ${costBudgetDay.userId} = reconciled_budget.user_id
          AND ${costBudgetDay.dayStartedAt} = reconciled_budget.day_started_at
        RETURNING
          EXISTS (SELECT 1 FROM claimed_reservation) AS allowed,
          claim_decision.cap_usd AS cap_usd,
          claim_decision.spent_usd AS spent_usd,
          claim_decision.reserved_usd AS reserved_usd,
          claim_decision.remaining_usd AS remaining_usd,
          (${costBudgetDay.dayStartedAt} = (SELECT day_started_at FROM budget_day)) AS is_current_day
      )
      SELECT
        updated_budget.allowed AS "allowed",
        updated_budget.cap_usd AS "capUsd",
        updated_budget.spent_usd + updated_budget.reserved_usd AS "spendUsd",
        updated_budget.remaining_usd AS "remainingUsd"
      FROM updated_budget
      WHERE updated_budget.is_current_day
    `),
  );

  const capUsd = toNumber(row?.capUsd ?? defaultDailyCostCapUsd);
  const spendUsd = toNumber(row?.spendUsd ?? 0);
  const allowed = row?.allowed === true || row?.allowed === 'true';
  if (!allowed) {
    const [activeReservation] = getRows<{ id: string; amountUsd: string | number }>(
      await database.execute(sql`
        WITH budget_day AS (
          SELECT ${dayStartedAtSql(now)} AS day_started_at
        )
        SELECT
          ${costReservation.id} AS "id",
          ${costReservation.amountUsd} AS "amountUsd"
        FROM ${costReservation}, budget_day
        WHERE ${costReservation.userId} = ${userId}
          AND ${costReservation.dayStartedAt} = budget_day.day_started_at
          AND ${costReservation.idempotencyKey} = ${reservation.idempotencyKey}
          AND ${costReservation.releasedAt} IS NULL
          AND ${costReservation.expiresAt} > ${now}
        LIMIT 1
      `),
    );
    const requestedAmountUsd = reservation.amountUsd ?? toNumber(activeReservation?.amountUsd);
    if (
      activeReservation !== undefined &&
      requestedAmountUsd <= toNumber(activeReservation.amountUsd)
    ) {
      return {
        allowed: true,
        capUsd,
        spendUsd,
        remainingUsd: toNumber(row?.remainingUsd ?? Math.max(0, capUsd - spendUsd)),
      };
    }
  }

  return {
    allowed,
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
            pricingVersion: CURRENT_PRICING_VERSION,
            window: event.window,
          },
          occurredAt,
          idempotencyKey: event.idempotencyKey,
        },
        event.amountUsd,
        occurredAt,
      );
    },
    enforceDailyCap: async (userId, reservation) => {
      const decision = await enforceDailyCap(
        database,
        userId,
        options.now?.() ?? new Date(),
        options.defaultDailyCostCapUsd ?? 25,
        reservation,
      );
      if (reservation !== undefined) return decision;
      return { allowed: decision.allowed };
    },
  };
}
