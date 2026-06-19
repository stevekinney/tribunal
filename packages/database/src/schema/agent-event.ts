import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agentRun } from './agent-run';

export const agentEvent = pgTable(
  'agent_event',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    agentRunId: text('agent_run_id')
      .notNull()
      .references(() => agentRun.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    tool: text('tool'),
    detail: jsonb('detail').notNull().default({}),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_event_agent_run_seq_idx').on(table.agentRunId, table.seq),
    index('agent_event_agent_run_idx').on(table.agentRunId, table.seq),
    check(
      'agent_event_kind_check',
      sql`${table.kind} IN ('session_start','tool_pre','tool_post','notification','message','stop','error')`,
    ),
    check('agent_event_seq_check', sql`${table.seq} >= 0`),
  ],
);

export type AgentEvent = typeof agentEvent.$inferSelect;
export type NewAgentEvent = typeof agentEvent.$inferInsert;
