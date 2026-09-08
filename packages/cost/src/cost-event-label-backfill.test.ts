/**
 * Exercises migration 0071's backfill against non-empty tables.
 *
 * The migration's forward path -- the BEFORE INSERT trigger and the writers -- is
 * covered by ledger.test.ts. Its two backfill passes were not: every suite applies the
 * migration to an EMPTY database and seeds afterwards, so the DO blocks were only ever
 * proven to parse and iterate zero times. A silently wrong join predicate would leave
 * historical rows permanently unlabelled, and the migration is forward-only.
 *
 * The SQL under test is read out of the shipped migration file rather than copied, so
 * this cannot drift from what actually runs in production.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, resetIdCounter } from '@tribunal/test/factories';
import { sql } from '@tribunal/database/operators';
import { agent, agentRun, costEvent, tribunalRun } from '@tribunal/database/schema';

const MIGRATION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../database/drizzle/0071_preserve-cost-event-agent-label.sql',
);

/**
 * The migration's two backfill passes, taken from the shipped file. Everything else in
 * it (the column, the trigger) is already applied by the test harness.
 */
function readBackfillStatements(): string[] {
  // Each backfill segment opens with explanatory SQL comments, so match on containing
  // the block rather than starting with it. The trigger segment uses `AS $$`, never
  // `DO $$`, so it is not caught by this.
  const statements = readFileSync(MIGRATION_PATH, 'utf-8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.includes('DO $$'));

  // Guards against the migration being restructured out from under this test: if the
  // passes are renamed, merged or removed, fail loudly rather than silently asserting
  // against nothing.
  expect(statements).toHaveLength(2);
  return statements;
}

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

describe('migration 0071 cost_event agent label backfill', () => {
  it('recovers labels from agent_run, from a live agent, and leaves the unrecoverable alone', async () => {
    const database = testDatabase.db;
    const factories = createFactories(database);
    const owner = await factories.user.create();
    const repository = await factories.repository.create({ id: 4242 });

    await database.insert(tribunalRun).values({
      id: 'run_backfill',
      userId: owner.id,
      repositoryId: repository.id,
      runKind: 'pull_request_review',
      status: 'running',
    });

    const [liveAgent] = await database
      .insert(agent)
      .values({
        id: 'agent_live',
        userId: owner.id,
        slug: 'live-agent',
        description: 'Still-configured agent',
        body: 'Review the pull request.',
      })
      .returning();

    // The agent this run belonged to is already gone, exactly as it would be after a
    // delete: agent_id is null on both sides and only agent_slug survives.
    await database.insert(agentRun).values({
      id: 'agent_run_deleted',
      userId: owner.id,
      runId: 'run_backfill',
      agentId: null,
      agentSlug: 'deleted-agent',
      role: 'specialist',
      status: 'succeeded',
    });

    // A triage run, which never has a configured agent. The forward-write rule skips
    // these, so the backfill must skip them too.
    await database.insert(agentRun).values({
      id: 'agent_run_triage',
      userId: owner.id,
      runId: 'run_backfill',
      agentId: null,
      agentSlug: 'some-slug',
      role: 'triage',
      status: 'succeeded',
    });

    await database.insert(costEvent).values([
      // Pass 1: recoverable through the deterministic llm:<agentRunId>:estimate key.
      {
        userId: owner.id,
        repositoryId: repository.id,
        reviewRunId: 'run_backfill',
        agentId: null,
        amountUsd: '0.01',
        idempotencyKey: 'llm:agent_run_deleted:estimate',
      },
      // Pass 2: the agent row is still live, so its slug is available directly.
      {
        userId: owner.id,
        repositoryId: repository.id,
        reviewRunId: 'run_backfill',
        agentId: liveAgent.id,
        amountUsd: '0.02',
        idempotencyKey: 'llm:agent_run_live:estimate',
      },
      // Unrecoverable: no surviving agent_run and no live agent. Stays "Unassigned".
      {
        userId: owner.id,
        repositoryId: repository.id,
        reviewRunId: 'run_backfill',
        agentId: null,
        amountUsd: '0.03',
        idempotencyKey: 'llm:agent_run_vanished:estimate',
      },
      // A triage cost event, which must not pick up the triage run's slug.
      {
        userId: owner.id,
        repositoryId: repository.id,
        reviewRunId: 'run_backfill',
        agentId: null,
        amountUsd: '0.04',
        idempotencyKey: 'llm:agent_run_triage:estimate',
      },
    ]);

    // The INSERT trigger labels rows whose agent is still live, so clear every label to
    // reproduce the pre-migration state the backfill actually runs against.
    await database.execute(sql`UPDATE "cost_event" SET "agent_label" = ''`);

    for (const statement of readBackfillStatements()) {
      await database.execute(sql.raw(statement));
    }

    const labels = new Map(
      (await database.select().from(costEvent)).map((row) => [row.idempotencyKey, row.agentLabel]),
    );

    expect(labels.get('llm:agent_run_deleted:estimate')).toBe('deleted-agent');
    expect(labels.get('llm:agent_run_live:estimate')).toBe('live-agent');
    expect(labels.get('llm:agent_run_vanished:estimate')).toBe('');
    expect(labels.get('llm:agent_run_triage:estimate')).toBe('');
  });

  it('is idempotent, so a re-run cannot relabel or clobber anything', async () => {
    const database = testDatabase.db;
    const factories = createFactories(database);
    const owner = await factories.user.create();
    const repository = await factories.repository.create({ id: 4343 });

    await database.insert(tribunalRun).values({
      id: 'run_backfill_twice',
      userId: owner.id,
      repositoryId: repository.id,
      runKind: 'pull_request_review',
      status: 'running',
    });
    await database.insert(agentRun).values({
      id: 'agent_run_twice',
      userId: owner.id,
      runId: 'run_backfill_twice',
      agentId: null,
      agentSlug: 'stable-agent',
      role: 'specialist',
      status: 'succeeded',
    });
    await database.insert(costEvent).values({
      userId: owner.id,
      repositoryId: repository.id,
      reviewRunId: 'run_backfill_twice',
      agentId: null,
      amountUsd: '0.01',
      idempotencyKey: 'llm:agent_run_twice:estimate',
    });
    await database.execute(sql`UPDATE "cost_event" SET "agent_label" = ''`);

    const statements = readBackfillStatements();
    for (const statement of [...statements, ...statements]) {
      await database.execute(sql.raw(statement));
    }

    const [row] = await database.select().from(costEvent);
    expect(row?.agentLabel).toBe('stable-agent');
  });
});
