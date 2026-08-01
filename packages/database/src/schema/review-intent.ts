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
import { user } from './user';

export const reviewIntent = pgTable(
  'review_intent',
  {
    id: text('id').primaryKey(),
    deliveryId: text('delivery_id').notNull(),
    kind: text('kind').notNull(),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),
    headSha: text('head_sha'),
    prState: text('pr_state'),
    // Check run created at webhook-intent time (before the engine claims the
    // intent), so the PR shows "queued" within seconds. The engine reuses this
    // id for all subsequent PATCHes instead of creating its own check run.
    checkRunId: bigint('check_run_id', { mode: 'number' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    failureCount: integer('failure_count').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('review_intent_delivery_kind_user_repository_pr_idx').on(
      table.deliveryId,
      table.kind,
      table.userId,
      table.repositoryId,
      table.prNumber,
    ),
    index('review_intent_unprocessed_claimed_idx')
      .on(table.claimedAt)
      .where(sql`${table.processedAt} IS NULL`),
    index('review_intent_next_attempt_idx')
      .on(table.nextAttemptAt)
      .where(sql`${table.processedAt} IS NULL AND ${table.deadLetteredAt} IS NULL`),
    index('review_intent_user_idx').on(table.userId),
    index('review_intent_ready_queue_idx')
      .on(table.createdAt, table.id, table.claimedAt, table.nextAttemptAt)
      .where(sql`${table.processedAt} IS NULL AND ${table.deadLetteredAt} IS NULL`),
    index('review_intent_repository_pr_idx').on(table.repositoryId, table.prNumber),
    check('review_intent_failure_count_check', sql`${table.failureCount} >= 0`),
    check(
      'review_intent_kind_check',
      sql`${table.kind} IN ('start','commit_pushed','pr_closed','manual')`,
    ),
    check(
      'review_intent_pr_state_check',
      sql`${table.prState} IS NULL OR ${table.prState} IN ('merged','closed')`,
    ),
  ],
);

export type ReviewIntent = typeof reviewIntent.$inferSelect;
export type NewReviewIntent = typeof reviewIntent.$inferInsert;
