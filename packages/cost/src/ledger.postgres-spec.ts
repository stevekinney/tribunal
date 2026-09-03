import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from '@tribunal/database/schema';
import { costBudgetDay, costEvent, costReservation } from '@tribunal/database/schema';
import { eq, isNull } from '@tribunal/database/operators';
import { createCostPort } from './ledger';

type CostPortDatabase = Parameters<typeof createCostPort>[0];

function createClient(): Client {
  return new Client(
    process.env.DATABASE_URL === undefined
      ? undefined
      : { connectionString: process.env.DATABASE_URL },
  );
}

async function getBackendPid(client: Client): Promise<number> {
  const {
    rows: [{ backend_pid: backendPid }],
  } = await client.query<{ backend_pid: number }>('SELECT pg_backend_pid() AS backend_pid');
  return backendPid;
}

async function waitForBlockedReservations(client: Client, backendPids: number[]): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { rows } = await client.query<{ blocked_count: string }>(
      `
      SELECT COUNT(*)::text AS blocked_count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid = ANY($1::integer[])
        AND wait_event_type = 'Lock'
    `,
      [backendPids],
    );
    if (Number(rows[0]?.blocked_count ?? 0) >= 2) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Expected both reservation sessions to wait on the cost_budget_day row lock.');
}

async function waitForBlockedSandboxEstimate(client: Client, backendPid: number): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { rows } = await client.query<{ blocked_count: string }>(
      `
      SELECT COUNT(*)::text AS blocked_count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid = $1
        AND wait_event_type = 'Lock'
    `,
      [backendPid],
    );
    if (Number(rows[0]?.blocked_count ?? 0) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Expected the sandbox estimate session to wait on the cost_budget_day row lock.');
}

let previousCaseTeardown: Promise<unknown> = Promise.resolve();

/**
 * Serializes case bodies against each other.
 *
 * Vitest stops awaiting a case once it exceeds its timeout, but the body keeps
 * executing. Without this gate the abandoned statements run against the next case's
 * freshly seeded rows: a reservation insert from the timed-out case lands under the
 * user id the next case just recreated, and that case then sees a row it never
 * seeded. Waiting here turns that contamination into an honest wait.
 */
async function claimCase(): Promise<() => void> {
  await previousCaseTeardown;
  let finishCase!: () => void;
  previousCaseTeardown = new Promise<void>((resolve) => {
    finishCase = resolve;
  });
  return finishCase;
}

/** Asserts the seeded ledger state a case depends on rather than assuming the truncate achieved it. */
async function assertSeededLedgerState(
  client: Client,
  expected: { reservations: number; budgetDays: number },
): Promise<void> {
  const {
    rows: [counts],
  } = await client.query<{ reservations: string; budget_days: string }>(`
    SELECT
      (SELECT COUNT(*)::text FROM "cost_reservation") AS reservations,
      (SELECT COUNT(*)::text FROM "cost_budget_day") AS budget_days
  `);
  expect({
    reservations: Number(counts?.reservations),
    budgetDays: Number(counts?.budget_days),
  }).toEqual(expected);
}

/** Runs one case under the serialization gate, so nothing it started outlives it. */
async function withCase<T>(run: () => Promise<T>): Promise<T> {
  const finishCase = await claimCase();
  try {
    return await run();
  } finally {
    finishCase();
  }
}

type LedgerSessions = {
  locker: Client;
  workers: Client[];
  /** Registers a statement started against a worker so teardown settles it. */
  track: <T>(work: Promise<T>) => Promise<T>;
};

/**
 * Gives a case a locker session plus `workerCount` independent sessions, and
 * guarantees on the way out that every statement it started has settled and every
 * session is closed before the next case begins.
 */
async function withLedgerSessions<T>(
  workerCount: number,
  run: (sessions: LedgerSessions) => Promise<T>,
): Promise<T> {
  return withCase(async () => {
    const locker = createClient();
    const workers = Array.from({ length: workerCount }, () => createClient());
    const inFlight: Promise<unknown>[] = [];
    try {
      await Promise.all([locker.connect(), ...workers.map((worker) => worker.connect())]);
      return await run({
        locker,
        workers,
        track: (work) => {
          inFlight.push(work.catch(() => undefined));
          return work;
        },
      });
    } finally {
      // Release the locker first: anything still waiting on its row lock can then
      // finish, so settling the tracked statements below cannot hang.
      await locker.query('ROLLBACK').catch(() => undefined);
      await Promise.allSettled(inFlight);
      await Promise.allSettled([locker.end(), ...workers.map((worker) => worker.end())]);
    }
  });
}

describe('cost ledger PostgreSQL reservation concurrency', () => {
  let adminClient: Client;

  beforeAll(async () => {
    adminClient = createClient();
    await adminClient.connect();
  });

  afterAll(async () => {
    // The last case can still be running if it overran its timeout, and its body
    // polls and verifies through adminClient. Closing that underneath it produces
    // exactly the noisy rejections the gate exists to prevent.
    await previousCaseTeardown;
    await adminClient.end();
  });

  it('allows only one independent session to reserve the final daily budget slot', async () => {
    await withLedgerSessions(2, async ({ locker, workers: [firstClient, secondClient], track }) => {
      await adminClient.query(
        'TRUNCATE "cost_reservation", "cost_budget_day", "user_review_settings", "user" RESTART IDENTITY CASCADE',
      );
      const {
        rows: [user],
      } = await adminClient.query<{ id: number }>(
        `INSERT INTO "user" ("username", "email") VALUES ('postgres-cost-user', 'postgres-cost@example.test') RETURNING "id"`,
      );
      await adminClient.query(
        `INSERT INTO "user_review_settings" ("user_id", "daily_cost_cap_usd") VALUES ($1, '0.01')`,
        [user.id],
      );
      await adminClient.query(
        `INSERT INTO "cost_budget_day" ("user_id", "day_started_at", "spent_usd", "reserved_usd")
           VALUES ($1, '2026-06-17T00:00:00.000Z', '0', '0')`,
        [user.id],
      );
      await assertSeededLedgerState(adminClient, { reservations: 0, budgetDays: 1 });

      const blockedBackendPids = await Promise.all([
        getBackendPid(firstClient),
        getBackendPid(secondClient),
      ]);

      await locker.query('BEGIN');
      await locker.query(
        `SELECT 1 FROM "cost_budget_day" WHERE "user_id" = $1 AND "day_started_at" = '2026-06-17T00:00:00.000Z' FOR UPDATE`,
        [user.id],
      );

      const firstDatabase = drizzle(firstClient, { schema }) as unknown as CostPortDatabase;
      const secondDatabase = drizzle(secondClient, { schema }) as unknown as CostPortDatabase;
      const now = new Date('2026-06-17T12:00:00.000Z');
      const firstDecision = track(
        createCostPort(firstDatabase, { now: () => now }).enforceDailyCap(user.id, {
          idempotencyKey: 'llm:postgres:first:estimate',
          expiresAt: new Date('2026-06-17T13:00:00.000Z'),
        }),
      );
      const secondDecision = track(
        createCostPort(secondDatabase, { now: () => now }).enforceDailyCap(user.id, {
          idempotencyKey: 'llm:postgres:second:estimate',
          expiresAt: new Date('2026-06-17T13:00:00.000Z'),
        }),
      );

      await waitForBlockedReservations(adminClient, blockedBackendPids);
      await locker.query('COMMIT');

      const decisions = await Promise.all([firstDecision, secondDecision]);
      expect(decisions.filter((decision) => decision.allowed)).toHaveLength(1);
      expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(1);

      const verificationDatabase = drizzle(adminClient, { schema });
      const activeReservations = await verificationDatabase
        .select()
        .from(costReservation)
        .where(isNull(costReservation.releasedAt));
      const [budget] = await verificationDatabase
        .select()
        .from(costBudgetDay)
        .where(eq(costBudgetDay.userId, user.id));
      expect(activeReservations).toHaveLength(1);
      expect(Number(budget?.reservedUsd)).toBe(0.01);
    });
  });

  it('treats duplicate concurrent reservation keys as one idempotent success', async () => {
    await withLedgerSessions(2, async ({ locker, workers: [firstClient, secondClient], track }) => {
      await adminClient.query(
        'TRUNCATE "cost_reservation", "cost_budget_day", "user_review_settings", "user" RESTART IDENTITY CASCADE',
      );
      const {
        rows: [user],
      } = await adminClient.query<{ id: number }>(
        `INSERT INTO "user" ("username", "email") VALUES ('postgres-duplicate-user', 'postgres-duplicate@example.test') RETURNING "id"`,
      );
      await adminClient.query(
        `INSERT INTO "user_review_settings" ("user_id", "daily_cost_cap_usd") VALUES ($1, '0.01')`,
        [user.id],
      );
      await adminClient.query(
        `INSERT INTO "cost_budget_day" ("user_id", "day_started_at", "spent_usd", "reserved_usd")
           VALUES ($1, '2026-06-17T00:00:00.000Z', '0', '0')`,
        [user.id],
      );
      await adminClient.query(
        `INSERT INTO "repository" ("id", "owner", "name")
           VALUES (42, 'postgres-owner', 'postgres-repository')
           ON CONFLICT ("id") DO NOTHING`,
      );
      await adminClient.query(
        `INSERT INTO "tribunal_run" ("id", "user_id", "repository_id", "run_kind", "status")
           VALUES ('run_postgres_sandbox', $1, 42, 'pull_request_review', 'running')`,
        [user.id],
      );
      await assertSeededLedgerState(adminClient, { reservations: 0, budgetDays: 1 });

      const blockedBackendPids = await Promise.all([
        getBackendPid(firstClient),
        getBackendPid(secondClient),
      ]);

      await locker.query('BEGIN');
      await locker.query(
        `SELECT 1 FROM "cost_budget_day" WHERE "user_id" = $1 AND "day_started_at" = '2026-06-17T00:00:00.000Z' FOR UPDATE`,
        [user.id],
      );

      const firstDatabase = drizzle(firstClient, { schema }) as unknown as CostPortDatabase;
      const secondDatabase = drizzle(secondClient, { schema }) as unknown as CostPortDatabase;
      const now = new Date('2026-06-17T12:00:00.000Z');
      const reservation = {
        idempotencyKey: 'llm:postgres:duplicate:estimate',
        amountUsd: 0.01,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      };
      const firstDecision = track(
        createCostPort(firstDatabase, { now: () => now }).enforceDailyCap(user.id, reservation),
      );
      const secondDecision = track(
        createCostPort(secondDatabase, { now: () => now }).enforceDailyCap(user.id, reservation),
      );

      await waitForBlockedReservations(adminClient, blockedBackendPids);
      await locker.query('COMMIT');

      const decisions = await Promise.all([firstDecision, secondDecision]);
      expect(decisions).toEqual([
        expect.objectContaining({ allowed: true }),
        expect.objectContaining({ allowed: true }),
      ]);

      const verificationDatabase = drizzle(adminClient, { schema });
      const activeReservations = await verificationDatabase
        .select()
        .from(costReservation)
        .where(isNull(costReservation.releasedAt));
      const [budget] = await verificationDatabase
        .select()
        .from(costBudgetDay)
        .where(eq(costBudgetDay.userId, user.id));
      expect(activeReservations).toHaveLength(1);
      expect(Number(budget?.reservedUsd)).toBe(0.01);
    });
  });

  it('releases one expired reservation only once across concurrent sessions', async () => {
    await withLedgerSessions(2, async ({ locker, workers: [firstClient, secondClient], track }) => {
      await adminClient.query(
        'TRUNCATE "cost_reservation", "cost_budget_day", "user_review_settings", "user" RESTART IDENTITY CASCADE',
      );
      const {
        rows: [user],
      } = await adminClient.query<{ id: number }>(
        `INSERT INTO "user" ("username", "email") VALUES ('postgres-expiry-user', 'postgres-expiry@example.test') RETURNING "id"`,
      );
      await adminClient.query(
        `INSERT INTO "user_review_settings" ("user_id", "daily_cost_cap_usd") VALUES ($1, '0.01')`,
        [user.id],
      );
      await adminClient.query(
        `INSERT INTO "cost_budget_day" ("user_id", "day_started_at", "spent_usd", "reserved_usd")
           VALUES ($1, '2026-06-17T00:00:00.000Z', '0', '0.01')`,
        [user.id],
      );
      await adminClient.query(
        `INSERT INTO "cost_reservation" ("id", "user_id", "day_started_at", "idempotency_key", "amount_usd", "expires_at", "created_at", "updated_at")
           VALUES ('cost_expired_reservation', $1, '2026-06-17T00:00:00.000Z', 'llm:postgres:expired:estimate', '0.01', '2026-06-17T11:00:00.000Z', '2026-06-17T10:00:00.000Z', '2026-06-17T10:00:00.000Z')`,
        [user.id],
      );
      // Only the seeded expired reservation may be present: the row count this case
      // asserts at the end is meaningless if a predecessor left one behind.
      await assertSeededLedgerState(adminClient, { reservations: 1, budgetDays: 1 });

      const blockedBackendPids = await Promise.all([
        getBackendPid(firstClient),
        getBackendPid(secondClient),
      ]);

      await locker.query('BEGIN');
      await locker.query(
        `SELECT 1 FROM "cost_budget_day" WHERE "user_id" = $1 AND "day_started_at" = '2026-06-17T00:00:00.000Z' FOR UPDATE`,
        [user.id],
      );

      const firstDatabase = drizzle(firstClient, { schema }) as unknown as CostPortDatabase;
      const secondDatabase = drizzle(secondClient, { schema }) as unknown as CostPortDatabase;
      const now = new Date('2026-06-17T12:00:00.000Z');
      const firstDecision = track(
        createCostPort(firstDatabase, { now: () => now }).enforceDailyCap(user.id, {
          idempotencyKey: 'llm:postgres:first-after-expiry:estimate',
          amountUsd: 0.01,
          expiresAt: new Date('2026-06-17T13:00:00.000Z'),
        }),
      );
      const secondDecision = track(
        createCostPort(secondDatabase, { now: () => now }).enforceDailyCap(user.id, {
          idempotencyKey: 'llm:postgres:second-after-expiry:estimate',
          amountUsd: 0.01,
          expiresAt: new Date('2026-06-17T13:00:00.000Z'),
        }),
      );

      await waitForBlockedReservations(adminClient, blockedBackendPids);
      await locker.query('COMMIT');

      const decisions = await Promise.all([firstDecision, secondDecision]);
      expect(decisions.filter((decision) => decision.allowed)).toHaveLength(1);
      expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(1);

      const verificationDatabase = drizzle(adminClient, { schema });
      const activeReservations = await verificationDatabase
        .select()
        .from(costReservation)
        .where(isNull(costReservation.releasedAt));
      const [budget] = await verificationDatabase
        .select()
        .from(costBudgetDay)
        .where(eq(costBudgetDay.userId, user.id));
      expect(activeReservations).toHaveLength(1);
      expect(Number(budget?.reservedUsd)).toBe(0.01);
    });
  });

  it('locks the daily budget row before inserting a sandbox estimate', async () => {
    await withLedgerSessions(1, async ({ locker, workers: [sandboxClient], track }) => {
      await adminClient.query(
        'TRUNCATE "cost_event", "cost_reservation", "cost_budget_day", "user_review_settings", "user" RESTART IDENTITY CASCADE',
      );
      const {
        rows: [user],
      } = await adminClient.query<{ id: number }>(
        `INSERT INTO "user" ("username", "email") VALUES ('postgres-sandbox-user', 'postgres-sandbox@example.test') RETURNING "id"`,
      );
      await adminClient.query(
        `INSERT INTO "cost_budget_day" ("user_id", "day_started_at", "spent_usd", "reserved_usd")
         VALUES ($1, '2026-06-17T00:00:00.000Z', '0', '0')`,
        [user.id],
      );
      await adminClient.query(
        `INSERT INTO "repository" ("id", "owner", "name")
         VALUES (42, 'postgres-owner', 'postgres-repository')
         ON CONFLICT ("id") DO NOTHING`,
      );
      await adminClient.query(
        `INSERT INTO "tribunal_run" ("id", "user_id", "repository_id", "run_kind", "status")
         VALUES ('run_postgres_sandbox', $1, 42, 'pull_request_review', 'running')`,
        [user.id],
      );
      await assertSeededLedgerState(adminClient, { reservations: 0, budgetDays: 1 });

      const sandboxBackendPid = await getBackendPid(sandboxClient);

      await locker.query('BEGIN');
      await locker.query(
        `SELECT 1 FROM "cost_budget_day" WHERE "user_id" = $1 AND "day_started_at" = '2026-06-17T00:00:00.000Z' FOR UPDATE`,
        [user.id],
      );

      const sandboxDatabase = drizzle(sandboxClient, { schema }) as unknown as CostPortDatabase;
      const sandboxWrite = track(
        createCostPort(sandboxDatabase, {
          now: () => new Date('2026-06-17T12:00:00.000Z'),
        }).recordSandbox({
          userId: user.id,
          repositoryId: 42,
          reviewRunId: 'run_postgres_sandbox',
          window: '2026-06-17T12:00:00.000Z',
          amountUsd: 0.01,
          idempotencyKey: 'sandbox:postgres-lock:2026-06-17T12',
        }),
      );

      await waitForBlockedSandboxEstimate(adminClient, sandboxBackendPid);
      const {
        rows: [{ count: eventCountBeforeUnlock }],
      } = await adminClient.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM "cost_event"',
      );
      expect(eventCountBeforeUnlock).toBe('0');

      await locker.query('COMMIT');
      await sandboxWrite;

      const verificationDatabase = drizzle(adminClient, { schema });
      const events = await verificationDatabase.select().from(costEvent);
      const [budget] = await verificationDatabase
        .select()
        .from(costBudgetDay)
        .where(eq(costBudgetDay.userId, user.id));
      expect(events).toHaveLength(1);
      expect(Number(budget?.spentUsd)).toBe(0.01);
    });
  });

  it('fails closed for an infinite stored daily cap', async () => {
    await withCase(async () => {
      await adminClient.query(
        'TRUNCATE "cost_reservation", "cost_budget_day", "user_review_settings", "user" RESTART IDENTITY CASCADE',
      );
      const {
        rows: [user],
      } = await adminClient.query<{ id: number }>(
        `INSERT INTO "user" ("username", "email") VALUES ('postgres-infinite-cap-user', 'postgres-infinite-cap@example.test') RETURNING "id"`,
      );
      await adminClient.query(
        `INSERT INTO "user_review_settings" ("user_id", "daily_cost_cap_usd") VALUES ($1, 'Infinity')`,
        [user.id],
      );
      // This case seeds no budget day; enforceDailyCap creates it.
      await assertSeededLedgerState(adminClient, { reservations: 0, budgetDays: 0 });

      const database = drizzle(adminClient, { schema }) as unknown as CostPortDatabase;
      const decision = await createCostPort(database, {
        now: () => new Date('2026-06-17T12:00:00.000Z'),
      }).enforceDailyCap(user.id, {
        idempotencyKey: 'llm:postgres:infinite-cap-estimate',
        amountUsd: 0.01,
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
      });

      expect(decision).toMatchObject({ allowed: false, capUsd: 0, remainingUsd: 0 });
    });
  });
});
