import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { repository } from './repository';

// ============================================================================
// ENUMS
// ============================================================================

export const ciStatusEnum = pgEnum('ci_status', [
  'pending',
  'passing',
  'failing',
  'error',
  'unknown',
]);

export const reviewStatusEnum = pgEnum('review_status', [
  'pending',
  'approved',
  'changes_requested',
  'commented',
  'unknown',
]);

export const mergeStatusEnum = pgEnum('merge_status', [
  'clean',
  'conflicts',
  'behind',
  'blocked',
  'unknown',
]);

export const automationStatusEnum = pgEnum('automation_status', [
  'idle',
  'queued',
  'running',
  'succeeded',
  'failed',
]);

// ============================================================================
// TABLE
// ============================================================================

export const pullRequestState = pgTable(
  'pull_request_state',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),

    // PR metadata
    state: text('state').notNull().default('open'), // 'open' | 'closed'
    isDraft: boolean('is_draft').notNull().default(false),
    isMerged: boolean('is_merged').notNull().default(false),
    headSha: text('head_sha'),
    baseSha: text('base_sha'),
    baseRef: text('base_ref'),

    // CI status
    ciStatus: ciStatusEnum('ci_status').notNull().default('unknown'),
    failingCheckCount: integer('failing_check_count').notNull().default(0),
    ciUpdatedAt: timestamp('ci_updated_at'),

    // Review status
    reviewStatus: reviewStatusEnum('review_status').notNull().default('unknown'),
    approvalCount: integer('approval_count').notNull().default(0),
    changesRequestedCount: integer('changes_requested_count').notNull().default(0),
    unresolvedThreadCount: integer('unresolved_thread_count').notNull().default(0),
    reviewUpdatedAt: timestamp('review_updated_at'),

    // Merge status
    mergeStatus: mergeStatusEnum('merge_status').notNull().default('unknown'),
    mergeUpdatedAt: timestamp('merge_updated_at'),

    // Automation
    automationStatus: automationStatusEnum('automation_status').notNull().default('idle'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastErrorMessage: text('last_error_message'),

    // Signature tracking
    lastTriggerSignature: text('last_trigger_signature'),
    signatureAttemptCount: integer('signature_attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at'),

    // Pause
    isPaused: boolean('is_paused').notNull().default(false),

    // Timestamps
    prUpdatedAt: timestamp('pr_updated_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('pull_request_state_repo_pr_idx').on(table.repositoryId, table.prNumber),
    index('pull_request_state_automation_idx').on(table.automationStatus),
    index('pull_request_state_repo_automation_idx').on(table.repositoryId, table.automationStatus),
  ],
);

// ============================================================================
// TYPES
// ============================================================================

export type PullRequestState = typeof pullRequestState.$inferSelect;
export type PullRequestStateInsert = typeof pullRequestState.$inferInsert;
export type CIStatus = (typeof ciStatusEnum.enumValues)[number];
export type ReviewStatus = (typeof reviewStatusEnum.enumValues)[number];
export type MergeStatus = (typeof mergeStatusEnum.enumValues)[number];
export type AutomationStatus = (typeof automationStatusEnum.enumValues)[number];
