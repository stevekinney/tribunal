import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { githubInstallation } from './github-installation';
import { repository } from './repository';

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Trigger types for pull request automation orchestration.
 * Each type corresponds to a webhook event that can trigger remediation.
 */
export const pullRequestTriggerTypeEnum = pgEnum('pull_request_trigger_type', [
  'ci_failure', // check_run.completed or check_suite.completed with failures
  'review_comment', // pull_request_review_comment.created
  'review', // pull_request_review.submitted
  'label', // pull_request.labeled
  'comment', // issue_comment.created with trigger keyword
]);

/**
 * Status of a trigger in the orchestration pipeline.
 */
export const pullRequestTriggerStatusEnum = pgEnum('pull_request_trigger_status', [
  'pending', // Waiting to be processed
  'processing', // Currently being handled by orchestrator
  'completed', // Successfully processed (child workflow started)
  'superseded', // Replaced by newer trigger with same signature
  'failed', // Processing failed (non-retryable)
  'skipped', // Skipped (e.g., stale head SHA)
]);

// ============================================================================
// TABLE
// ============================================================================

/**
 * Tracks remediation triggers for pull request automation orchestration.
 *
 * Each trigger represents a webhook event that may initiate a remediation run.
 * The orchestrator deduplicates by (head_sha, trigger_type, signature) to prevent
 * redundant remediation runs from rapid-fire webhooks.
 *
 * Key invariants:
 * - Only one trigger per (head_sha, trigger_type, signature) is processed
 * - Triggers for stale head SHAs are skipped
 * - The orchestrator processes triggers in order, with debounce
 */
export const pullRequestTrigger = pgTable(
  'pull_request_trigger',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

    // Scope
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number').notNull(),

    // Trigger identification
    triggerType: pullRequestTriggerTypeEnum('trigger_type').notNull(),
    headSha: text('head_sha').notNull(),
    signature: text('signature').notNull(), // Unique identifier within type (e.g., check_run_id:failure_count)

    // Context (with FK constraints per database.md rules)
    installationId: bigint('installation_id', { mode: 'number' })
      .notNull()
      .references(() => githubInstallation.installationId, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id').notNull(),

    // Processing state
    status: pullRequestTriggerStatusEnum('status').notNull().default('pending'),
    orchestratorWorkflowId: text('orchestrator_workflow_id'),
    childWorkflowId: text('child_workflow_id'), // The remediation workflow if started

    // Trigger actor attribution (for commit trailers, notifications)
    triggeredByUserId: integer('triggered_by_user_id'), // Internal user ID that triggered the workflow
    triggerActorLogin: text('trigger_actor_login'), // GitHub login of the trigger actor

    // Attempt tracking for backoff
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),

    // Error tracking
    errorMessage: text('error_message'),

    // Timestamps (using withTimezone for consistency with newer tables)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Primary lookup: find triggers for a PR
    index('pull_request_trigger_repo_pr_idx').on(table.repositoryId, table.prNumber),

    // Deduplication: prevent duplicate triggers for same (head_sha, trigger_type, signature)
    uniqueIndex('pull_request_trigger_dedupe_idx').on(
      table.repositoryId,
      table.prNumber,
      table.headSha,
      table.triggerType,
      table.signature,
    ),

    // Orchestrator query: find pending triggers for processing
    index('pull_request_trigger_status_idx').on(table.status),

    // Orchestrator query: find triggers ready for retry
    index('pull_request_trigger_next_attempt_idx').on(table.status, table.nextAttemptAt),

    // FK column indexes
    index('pull_request_trigger_installation_idx').on(table.installationId),
    index('pull_request_trigger_workspace_idx').on(table.workspaceId),
  ],
);

// ============================================================================
// TYPES
// ============================================================================

export type PullRequestTrigger = typeof pullRequestTrigger.$inferSelect;
export type PullRequestTriggerInsert = typeof pullRequestTrigger.$inferInsert;
export type PullRequestTriggerType = (typeof pullRequestTriggerTypeEnum.enumValues)[number];
export type PullRequestTriggerStatus = (typeof pullRequestTriggerStatusEnum.enumValues)[number];
