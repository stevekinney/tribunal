import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agentRun } from './agent-run';
import { user } from './user';

export const finding = pgTable(
  'finding',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    agentRunId: text('agent_run_id')
      .notNull()
      .references(() => agentRun.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    startLine: integer('start_line'),
    endLine: integer('end_line'),
    side: text('side').notNull().default('RIGHT'),
    severity: text('severity').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    suggestion: text('suggestion'),
    anchored: boolean('anchored').notNull().default(false),
    githubCommentId: bigint('github_comment_id', { mode: 'number' }),
    fingerprint: text('fingerprint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('finding_agent_run_fingerprint_idx').on(table.agentRunId, table.fingerprint),
    index('finding_agent_run_idx').on(table.agentRunId),
    index('finding_user_idx').on(table.userId),
    check('finding_side_check', sql`${table.side} IN ('LEFT','RIGHT')`),
    check('finding_severity_check', sql`${table.severity} IN ('info','warning','error')`),
    check('finding_start_line_check', sql`${table.startLine} IS NULL OR ${table.startLine} > 0`),
    check('finding_end_line_check', sql`${table.endLine} IS NULL OR ${table.endLine} > 0`),
  ],
);

export type Finding = typeof finding.$inferSelect;
export type NewFinding = typeof finding.$inferInsert;
