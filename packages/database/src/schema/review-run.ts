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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { repository } from './repository';
import { user } from './user';

export const reviewRun = pgTable(
  'review_run',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),
    headSha: text('head_sha').notNull(),
    prevHeadSha: text('prev_head_sha'),
    trigger: text('trigger').notNull(),
    status: text('status').notNull().default('queued'),
    workflowId: text('workflow_id'),
    sandboxId: text('sandbox_id'),
    checkRunId: bigint('check_run_id', { mode: 'number' }),
    commentsPosted: integer('comments_posted').notNull().default(0),
    reviewPostClaimedAt: timestamp('review_post_claimed_at', { withTimezone: true }),
    costEstimateUsd: numeric('cost_estimate_usd').notNull().default('0'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
  },
  (table) => [
    uniqueIndex('review_run_user_repository_pr_head_trigger_idx').on(
      table.userId,
      table.repositoryId,
      table.prNumber,
      table.headSha,
      table.trigger,
    ),
    index('review_run_repository_pr_status_idx').on(
      table.repositoryId,
      table.prNumber,
      table.status,
    ),
    index('review_run_user_idx').on(table.userId),
    check(
      'review_run_status_check',
      sql`${table.status} IN ('queued','running','posted','superseded','failed','cancelled','quota_blocked')`,
    ),
    check(
      'review_run_trigger_check',
      sql`${table.trigger} IN ('opened','synchronize','reopened','manual')`,
    ),
    check('review_run_comments_posted_check', sql`${table.commentsPosted} >= 0`),
    check('review_run_cost_estimate_check', sql`${table.costEstimateUsd} >= 0`),
  ],
);

export type ReviewRun = typeof reviewRun.$inferSelect;
export type NewReviewRun = typeof reviewRun.$inferInsert;
