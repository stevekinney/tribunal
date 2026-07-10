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
    // Adversarial verification (T-10): only `verified` findings are eligible to
    // post. `verifierAgentRunId` points at the verifier's own `agent_run` row
    // (role `verifier`), which carries the model/cost/usage for that check.
    // `merged` (T-11): this finding was verified but absorbed as a
    // near-duplicate into another finding's `mergedFingerprints` — it is
    // never posted and must not be double-counted alongside its survivor.
    verificationStatus: text('verification_status').notNull().default('pending'),
    verificationNote: text('verification_note'),
    verifierAgentRunId: text('verifier_agent_run_id').references(() => agentRun.id, {
      onDelete: 'set null',
    }),
    // Cross-agent dedup (T-11): fingerprints of near-duplicate findings this
    // row absorbed via `mergeNearDuplicateFindings`. Phase 3's carried-forward
    // dedup matches a re-reported finding against this row's own fingerprint
    // OR any fingerprint here.
    mergedFingerprints: text('merged_fingerprints')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('finding_agent_run_fingerprint_idx').on(table.agentRunId, table.fingerprint),
    index('finding_agent_run_idx').on(table.agentRunId),
    index('finding_user_idx').on(table.userId),
    index('finding_verifier_agent_run_idx').on(table.verifierAgentRunId),
    check('finding_side_check', sql`${table.side} IN ('LEFT','RIGHT')`),
    check('finding_severity_check', sql`${table.severity} IN ('info','warning','error')`),
    check('finding_start_line_check', sql`${table.startLine} IS NULL OR ${table.startLine} > 0`),
    check('finding_end_line_check', sql`${table.endLine} IS NULL OR ${table.endLine} > 0`),
    check(
      'finding_verification_status_check',
      sql`${table.verificationStatus} IN ('pending','verified','rejected','merged')`,
    ),
  ],
);

export type Finding = typeof finding.$inferSelect;
export type NewFinding = typeof finding.$inferInsert;
