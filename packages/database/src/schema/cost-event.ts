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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agent } from './agent';
import { agentRun } from './agent-run';
import { repository } from './repository';
import { reviewRun } from './review-run';
import { user } from './user';

export const costEvent = pgTable(
  'cost_event',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    source: text('source').notNull().default('estimate'),
    repositoryId: bigint('repository_id', { mode: 'number' }).references(() => repository.id, {
      onDelete: 'set null',
    }),
    reviewRunId: text('review_run_id').references(() => reviewRun.id, { onDelete: 'set null' }),
    agentRunId: text('agent_run_id').references(() => agentRun.id, { onDelete: 'set null' }),
    agentId: text('agent_id').references(() => agent.id, { onDelete: 'set null' }),
    amountUsd: numeric('amount_usd').notNull(),
    meta: jsonb('meta').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text('idempotency_key').notNull(),
  },
  (table) => [
    uniqueIndex('cost_event_idempotency_key_idx').on(table.idempotencyKey),
    index('cost_event_user_occurred_idx').on(table.userId, table.occurredAt),
    index('cost_event_review_run_idx').on(table.reviewRunId),
    index('cost_event_repository_agent_idx').on(table.repositoryId, table.agentId),
    index('cost_event_source_idx').on(table.source),
    index('cost_event_agent_run_idx').on(table.agentRunId),
    check('cost_event_kind_check', sql`${table.kind} IN ('llm','sandbox')`),
    check('cost_event_source_check', sql`${table.source} IN ('estimate','reconciled')`),
    check('cost_event_amount_check', sql`${table.amountUsd} >= 0`),
  ],
);

export type CostEvent = typeof costEvent.$inferSelect;
export type NewCostEvent = typeof costEvent.$inferInsert;
