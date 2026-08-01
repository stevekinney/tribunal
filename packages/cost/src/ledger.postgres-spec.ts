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

describe('cost ledger PostgreSQL reservation concurrency', () => {
  let adminClient: Client;

  beforeAll(async () => {
    adminClient = createClient();
    await adminClient.connect();
  });

  afterAll(async () => {
    await adminClient.end();
  });

  it('allows only one independent session to reserve the final daily budget slot', async () => {
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

    const locker = createClient();
    const firstClient = createClient();
    const secondClient = createClient();
    await Promise.all([locker.connect(), firstClient.connect(), secondClient.connect()]);
    const blockedBackendPids = await Promise.all([
      getBackendPid(firstClient),
      getBackendPid(secondClient),
    ]);

    try {
      await locker.query('BEGIN');
      await locker.query(
        `SELECT 1 FROM "cost_budget_day" WHERE "user_id" = $1 AND "day_started_at" = '2026-06-17T00:00:00.000Z' FOR UPDATE`,
        [user.id],
      );

      const firstDatabase = drizzle(firstClient, { schema }) as unknown as CostPortDatabase;
      const secondDatabase = drizzle(secondClient, { schema }) as unknown as CostPortDatabase;
      const now = new Date('2026-06-17T12:00:00.000Z');
      const firstDecision = createCostPort(firstDatabase, { now: () => now }).enforceDailyCap(
        user.id,
        {
          idempotencyKey: 'llm:postgres:first:estimate',
          expiresAt: new Date('2026-06-17T13:00:00.000Z'),
        },
      );
      const secondDecision = createCostPort(secondDatabase, { now: () => now }).enforceDailyCap(
        user.id,
        {
          idempotencyKey: 'llm:postgres:second:estimate',
          expiresAt: new Date('2026-06-17T13:00:00.000Z'),
        },
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
    } finally {
      await locker.query('ROLLBACK').catch(() => undefined);
      await Promise.all([locker.end(), firstClient.end(), secondClient.end()]);
    }
  });

  it('treats duplicate concurrent reservation keys as one idempotent success', async () => {
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

    const locker = createClient();
    const firstClient = createClient();
    const secondClient = createClient();
    await Promise.all([locker.connect(), firstClient.connect(), secondClient.connect()]);
    const blockedBackendPids = await Promise.all([
      getBackendPid(firstClient),
      getBackendPid(secondClient),
    ]);

    try {
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
      const firstDecision = createCostPort(firstDatabase, { now: () => now }).enforceDailyCap(
        user.id,
        reservation,
      );
      const secondDecision = createCostPort(secondDatabase, { now: () => now }).enforceDailyCap(
        user.id,
        reservation,
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
    } finally {
      await locker.query('ROLLBACK').catch(() => undefined);
      await Promise.all([locker.end(), firstClient.end(), secondClient.end()]);
    }
  });

  it('releases one expired reservation only once across concurrent sessions', async () => {
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

    const locker = createClient();
    const firstClient = createClient();
    const secondClient = createClient();
    await Promise.all([locker.connect(), firstClient.connect(), secondClient.connect()]);
    const blockedBackendPids = await Promise.all([
      getBackendPid(firstClient),
      getBackendPid(secondClient),
    ]);

    try {
      await locker.query('BEGIN');
      await locker.query(
        `SELECT 1 FROM "cost_budget_day" WHERE "user_id" = $1 AND "day_started_at" = '2026-06-17T00:00:00.000Z' FOR UPDATE`,
        [user.id],
      );

      const firstDatabase = drizzle(firstClient, { schema }) as unknown as CostPortDatabase;
      const secondDatabase = drizzle(secondClient, { schema }) as unknown as CostPortDatabase;
      const now = new Date('2026-06-17T12:00:00.000Z');
      const firstDecision = createCostPort(firstDatabase, { now: () => now }).enforceDailyCap(
        user.id,
        {
          idempotencyKey: 'llm:postgres:first-after-expiry:estimate',
          amountUsd: 0.01,
          expiresAt: new Date('2026-06-17T13:00:00.000Z'),
        },
      );
      const secondDecision = createCostPort(secondDatabase, { now: () => now }).enforceDailyCap(
        user.id,
        {
          idempotencyKey: 'llm:postgres:second-after-expiry:estimate',
          amountUsd: 0.01,
          expiresAt: new Date('2026-06-17T13:00:00.000Z'),
        },
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
    } finally {
      await locker.query('ROLLBACK').catch(() => undefined);
      await Promise.all([locker.end(), firstClient.end(), secondClient.end()]);
    }
  });

  it('locks the daily budget row before inserting a sandbox estimate', async () => {
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

    const locker = createClient();
    const sandboxClient = createClient();
    await Promise.all([locker.connect(), sandboxClient.connect()]);
    const sandboxBackendPid = await getBackendPid(sandboxClient);

    try {
      await locker.query('BEGIN');
      await locker.query(
        `SELECT 1 FROM "cost_budget_day" WHERE "user_id" = $1 AND "day_started_at" = '2026-06-17T00:00:00.000Z' FOR UPDATE`,
        [user.id],
      );

      const sandboxDatabase = drizzle(sandboxClient, { schema }) as unknown as CostPortDatabase;
      const sandboxWrite = createCostPort(sandboxDatabase, {
        now: () => new Date('2026-06-17T12:00:00.000Z'),
      }).recordSandbox({
        userId: user.id,
        repositoryId: 42,
        reviewRunId: 'run_postgres_sandbox',
        window: '2026-06-17T12:00:00.000Z',
        amountUsd: 0.01,
        idempotencyKey: 'sandbox:postgres-lock:2026-06-17T12',
      });

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
    } finally {
      await locker.query('ROLLBACK').catch(() => undefined);
      await Promise.all([locker.end(), sandboxClient.end()]);
    }
  });
});
