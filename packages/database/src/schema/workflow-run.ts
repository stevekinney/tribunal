import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { errorCategoryEnum, workflowPhaseEnum, workflowTaskTypeEnum } from './enums';
import { pullRequestTrigger } from './pull-request-trigger';
import { repository } from './repository';
import type { CommitInfo, ResolutionArtifact, WorkflowRunArtifacts } from './types';
import { user } from './user';

/**
 * Workflow runs track durable workflow executions for observability.
 * Each run represents a single execution of a workflow (analysis, remediation, etc.).
 *
 * TODO(weft): Reconcile this schema with ../weft execution identifiers before
 * re-enabling workflow producers. These columns were originally modeled around
 * Temporal workflow and run IDs.
 */
export const workflowRun = pgTable(
  'workflow_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Durable workflow identifiers.
    workflowId: text('workflow_id').notNull(), // Workflow ID (unique)
    runId: text('run_id'), // Engine run ID when the workflow backend exposes one.

    // Scope
    workspaceId: integer('workspace_id').notNull(),
    repositoryId: bigint('repository_id', { mode: 'number' }).references(() => repository.id, {
      onDelete: 'set null',
    }),
    pullRequestNumber: integer('pull_request_number'),

    // Task metadata
    taskType: workflowTaskTypeEnum('task_type').notNull(),
    triggerSource: text('trigger_source').notNull(), // webhook | api | manual
    triggerMetadata: jsonb('trigger_metadata'),

    // Execution state
    phase: workflowPhaseEnum('phase').notNull().default('pending'),
    // Template metadata (captured at workflow start)
    templateAlias: text('template_alias'),
    templateId: text('template_id'),
    envdVersion: text('envd_version'),

    // Results
    filesChanged: text('files_changed').array(),
    commitSha: text('commit_sha'),
    tokensUsed: integer('tokens_used').default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).default('0'),

    // Error tracking
    errorMessage: text('error_message'),
    errorCategory: errorCategoryEnum('error_category'),
    errorCode: text('error_code'), // Specific error code (e.g., 'rate_limit')

    // Retry tracking
    retryOfWorkflowId: text('retry_of_workflow_id'), // References workflowRun.workflowId if this is a retry

    // Commit metadata (stored on completion)
    commits: jsonb('commits').$type<CommitInfo[]>(), // Array of commit info for revert guidance
    // Validation warning (commit proceeded despite validation failure)
    validationWarning: boolean('validation_warning').default(false),
    // Review comment resolution results (remediation workflows)
    resolutionArtifact: jsonb('resolution_artifact').$type<ResolutionArtifact | null>(),

    // Structured artifacts (CI context, agent plan, validation evidence)
    artifacts: jsonb('artifacts').$type<WorkflowRunArtifacts | null>(),

    // Trigger actor attribution
    triggerActorId: bigint('trigger_actor_id', { mode: 'number' }),
    triggerActorLogin: text('trigger_actor_login'),
    triggeredByUserId: integer('triggered_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    // Cancellation tracking
    cancellationReason: text('cancellation_reason'),

    // Orchestrator tracking
    orchestratorWorkflowId: text('orchestrator_workflow_id'), // Parent orchestrator workflow ID
    triggerId: integer('trigger_id').references(() => pullRequestTrigger.id, {
      onDelete: 'set null',
    }), // Reference to pull_request_trigger.id

    // Timestamps
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('workflow_run_workflow_id_idx').on(table.workflowId),
    index('workflow_run_workspace_phase_idx').on(table.workspaceId, table.phase),
    index('workflow_run_repository_phase_idx').on(table.repositoryId, table.phase),
    index('workflow_run_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('workflow_run_error_code_idx').on(table.errorCode),
    index('workflow_run_retry_of_idx').on(table.retryOfWorkflowId),
    index('workflow_run_trigger_idx').on(table.triggerId),
    index('workflow_run_triggered_by_user_idx').on(table.triggeredByUserId),
  ],
);

export type WorkflowRun = typeof workflowRun.$inferSelect;
export type NewWorkflowRun = typeof workflowRun.$inferInsert;
