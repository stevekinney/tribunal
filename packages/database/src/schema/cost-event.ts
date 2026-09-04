import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { agent } from './agent';
import { repository } from './repository';
import { tribunalRun } from './tribunal-run';
import { user } from './user';

export const costEvent = pgTable(
  'cost_event',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('estimate'),
    repositoryId: bigint('repository_id', { mode: 'number' }).references(() => repository.id, {
      onDelete: 'set null',
    }),
    // References the generic `tribunal_run` parent, not just pull request review runs.
    reviewRunId: text('review_run_id').references(() => tribunalRun.id, { onDelete: 'set null' }),
    agentId: text('agent_id').references(() => agent.id, { onDelete: 'set null' }),
    // Label snapshot written at insert time, mirroring `agent_run.agent_slug`.
    // Survives the referenced `agent` row being deleted, so historical
    // rollups can still attribute this event to the agent that produced it.
    // Empty string means "no configured agent" (sandbox costs, triage,
    // verifier) -- readers fall back to "Unassigned" for that case.
    agentLabel: text('agent_label').notNull().default(''),
    amountUsd: numeric('amount_usd').notNull(),
    meta: jsonb('meta').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text('idempotency_key').primaryKey(),
  },
  (table) => [
    index('cost_event_user_occurred_idx').on(table.userId, table.occurredAt),
    index('cost_event_review_run_idx').on(table.reviewRunId),
    index('cost_event_repository_agent_idx').on(table.repositoryId, table.agentId),
    index('cost_event_source_idx').on(table.source),
    check('cost_event_source_check', sql`${table.source} IN ('estimate','reconciled')`),
    check('cost_event_amount_check', sql`${table.amountUsd} >= 0`),
  ],
);

export type CostEvent = typeof costEvent.$inferSelect;
export type NewCostEvent = typeof costEvent.$inferInsert;
