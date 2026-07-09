import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { repository } from './repository';
import { user } from './user';

/**
 * Generic parent run table for durable Tribunal work. Every unit of durable
 * work (a pull request review today, a webhook-triggered event handler in a
 * later phase) gets one `tribunal_run` row holding the fields that are true
 * regardless of what triggered the run: who owns it, which repository it
 * belongs to, its lifecycle status, and its cost/timing summary.
 *
 * Kind-specific fields live in a child detail table keyed 1:1 on `id`
 * (see `pull_request_review_run`). This table's `id` values are preserved
 * from the legacy `review_run` table it replaces, so existing identifiers
 * embedded elsewhere (the signed GitHub comment marker, agent run ids,
 * capability tokens) remain valid without remapping.
 */
export const tribunalRun = pgTable(
  'tribunal_run',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    runKind: text('run_kind').notNull(),
    status: text('status').notNull().default('queued'),
    workflowId: text('workflow_id'),
    sandboxId: text('sandbox_id'),
    costEstimateUsd: numeric('cost_estimate_usd').notNull().default('0'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
  },
  (table) => [
    // Backs the composite foreign key from pull_request_review_run(run_id,
    // user_id, repository_id), so the database rejects a child row whose
    // user/repository ever diverges from its parent's. A named UNIQUE
    // constraint (not just a unique index) is required here -- PGlite's
    // migrator does not recognize a bare unique index as a valid foreign key
    // reference target.
    unique('tribunal_run_id_user_repository_unique').on(table.id, table.userId, table.repositoryId),
    index('tribunal_run_user_idx').on(table.userId),
    index('tribunal_run_repository_run_kind_idx').on(table.repositoryId, table.runKind),
    check(
      'tribunal_run_kind_check',
      sql`${table.runKind} IN ('pull_request_review','webhook_event_handler')`,
    ),
    check(
      'tribunal_run_status_check',
      sql`${table.status} IN ('queued','running','posted','superseded','failed','cancelled','quota_blocked')`,
    ),
    check('tribunal_run_cost_estimate_check', sql`${table.costEstimateUsd} >= 0`),
  ],
);

export type TribunalRun = typeof tribunalRun.$inferSelect;
export type NewTribunalRun = typeof tribunalRun.$inferInsert;
