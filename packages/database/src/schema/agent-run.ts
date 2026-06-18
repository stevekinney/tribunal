import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agent } from './agent';
import { reviewRun } from './review-run';
import { user } from './user';

export const agentRun = pgTable(
  'agent_run',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    reviewRunId: text('review_run_id')
      .notNull()
      .references(() => reviewRun.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agent.id, { onDelete: 'cascade' }),
    modelUsed: text('model_used'),
    effortUsed: text('effort_used'),
    status: text('status').notNull().default('queued'),
    findingsCount: integer('findings_count').notNull().default(0),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
    cacheCreationTokens: bigint('cache_creation_tokens', { mode: 'number' }).notNull().default(0),
    costEstimateUsd: numeric('cost_estimate_usd').notNull().default('0'),
    durationMs: integer('duration_ms'),
    stoppedReason: text('stopped_reason'),
    error: text('error'),
  },
  (table) => [
    uniqueIndex('agent_run_review_run_agent_idx').on(table.reviewRunId, table.agentId),
    index('agent_run_review_run_idx').on(table.reviewRunId),
    index('agent_run_user_idx').on(table.userId),
    index('agent_run_agent_idx').on(table.agentId),
    check(
      'agent_run_status_check',
      sql`${table.status} IN ('queued','running','succeeded','failed','cancelled')`,
    ),
    check(
      'agent_run_effort_used_check',
      sql`${table.effortUsed} IS NULL OR ${table.effortUsed} IN ('low','medium','high','xhigh','max')`,
    ),
    check(
      'agent_run_stopped_reason_check',
      sql`${table.stoppedReason} IS NULL OR ${table.stoppedReason} IN ('superseded','pr_closed','budget','timeout','operator')`,
    ),
    check('agent_run_findings_count_check', sql`${table.findingsCount} >= 0`),
    check('agent_run_input_tokens_check', sql`${table.inputTokens} >= 0`),
    check('agent_run_output_tokens_check', sql`${table.outputTokens} >= 0`),
    check('agent_run_cache_read_tokens_check', sql`${table.cacheReadTokens} >= 0`),
    check('agent_run_cache_creation_tokens_check', sql`${table.cacheCreationTokens} >= 0`),
    check('agent_run_cost_estimate_check', sql`${table.costEstimateUsd} >= 0`),
  ],
);

export type AgentRun = typeof agentRun.$inferSelect;
export type NewAgentRun = typeof agentRun.$inferInsert;
