import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { repository } from './repository';
import { tribunalRun } from './tribunal-run';
import { user } from './user';

/**
 * Pull request review-specific detail for a `tribunal_run` row. One row per
 * parent run, keyed 1:1 on `runId` (the parent's `id`). `userId` and
 * `repositoryId` are denormalized copies of the parent's values, written once
 * at insert time from the same source and never updated independently -- this
 * reproduces the exact composite uniqueness the legacy `review_run` table
 * enforced without a cross-table constraint.
 */
export const pullRequestReviewRun = pgTable(
  'pull_request_review_run',
  {
    runId: text('run_id')
      .primaryKey()
      .references(() => tribunalRun.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),
    headSha: text('head_sha').notNull(),
    prevHeadSha: text('prev_head_sha'),
    // Hash of the reviewed diff's content (path + patch), independent of commit
    // sha. Lets a later run detect "diff unchanged since last review" (e.g. a
    // rebase that doesn't change the patch) and skip re-running agents.
    patchId: text('patch_id'),
    trigger: text('trigger').notNull(),
    checkRunId: bigint('check_run_id', { mode: 'number' }),
    commentsPosted: integer('comments_posted').notNull().default(0),
    reviewPostClaimedAt: timestamp('review_post_claimed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('pull_request_review_run_user_repository_pr_head_trigger_idx').on(
      table.userId,
      table.repositoryId,
      table.prNumber,
      table.headSha,
      table.trigger,
    ),
    index('pull_request_review_run_repository_pr_idx').on(table.repositoryId, table.prNumber),
    index('pull_request_review_run_user_idx').on(table.userId),
    check('pull_request_review_run_comments_posted_check', sql`${table.commentsPosted} >= 0`),
    check(
      'pull_request_review_run_trigger_check',
      sql`${table.trigger} IN ('opened','synchronize','reopened','manual')`,
    ),
  ],
);

export type PullRequestReviewRun = typeof pullRequestReviewRun.$inferSelect;
export type NewPullRequestReviewRun = typeof pullRequestReviewRun.$inferInsert;
