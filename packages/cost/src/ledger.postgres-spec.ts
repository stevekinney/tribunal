import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from '@tribunal/database/schema';
import { costBudgetDay, costReservation } from '@tribunal/database/schema';
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

async function waitForBlockedReservations(client: Client): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { rows } = await client.query<{ blocked_count: string }>(`
      SELECT COUNT(*)::text AS blocked_count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE '%cost_budget_day%'
        AND query LIKE '%FOR UPDATE%'
    `);
    if (Number(rows[0]?.blocked_count ?? 0) >= 2) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Expected both reservation sessions to wait on the cost_budget_day row lock.');
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
          amountUsd: 0.01,
          expiresAt: new Date('2026-06-17T13:00:00.000Z'),
        },
      );
      const secondDecision = createCostPort(secondDatabase, { now: () => now }).enforceDailyCap(
        user.id,
        {
          idempotencyKey: 'llm:postgres:second:estimate',
          amountUsd: 0.01,
          expiresAt: new Date('2026-06-17T13:00:00.000Z'),
        },
      );

      await waitForBlockedReservations(adminClient);
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
});
