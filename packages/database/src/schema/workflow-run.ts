import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { errorCategoryEnum, workflowPhaseEnum, workflowTaskTypeEnum } from './enums';
import { repository } from './repository';
import { user } from './user';

/**
 * Workflow runs are an **observability read-model** for durable workflow
 * executions — not the execution substrate.
 *
 * Weft owns execution state in its own durable store (the `kv` table in
 * `WEFT_DATABASE_URL`); this table is a projection that workflow activities and
 * interceptors write so the app can surface "what ran, for which PR, in what
 * phase, and how it ended" without querying the engine. It deliberately holds
 * only scope, status, attribution, and error/timestamp fields. The Temporal-era
 * execution columns (run/template/sandbox/commit/cost/artifact tracking, the
 * relational `pull_request_trigger` dedup machinery, retry chaining) were
 * dropped: coalescing/dedup/debounce now live inside the Weft workflows
 * (`startOrSignal` idempotency + an in-workflow sliding debounce), so the
 * relational mirror is redundant.
 */
export const workflowRun = pgTable(
  'workflow_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Durable workflow identity (the Weft workflow id; unique).
    workflowId: text('workflow_id').notNull(),
    // Engine run id when the backend exposes one (a workflow id can have
    // successive runs across restart-as-new).
    runId: text('run_id'),

    // Scope
    workspaceId: integer('workspace_id').notNull(),
    repositoryId: bigint('repository_id', { mode: 'number' }).references(() => repository.id, {
      onDelete: 'set null',
    }),
    pullRequestNumber: integer('pull_request_number'),

    // Classification
    taskType: workflowTaskTypeEnum('task_type').notNull(),
    triggerSource: text('trigger_source').notNull(), // webhook | api | manual

    // Status projection
    phase: workflowPhaseEnum('phase').notNull().default('pending'),

    // Error tracking
    errorMessage: text('error_message'),
    errorCategory: errorCategoryEnum('error_category'),

    // Trigger actor attribution
    triggerActorLogin: text('trigger_actor_login'),
    triggeredByUserId: integer('triggered_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    // Cancellation tracking
    cancellationReason: text('cancellation_reason'),

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
    // Unique on the Weft workflow id (the validate-invariants suite asserts this).
    uniqueIndex('workflow_run_workflow_id_idx').on(table.workflowId),
    index('workflow_run_workspace_phase_idx').on(table.workspaceId, table.phase),
    index('workflow_run_repository_phase_idx').on(table.repositoryId, table.phase),
    index('workflow_run_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('workflow_run_triggered_by_user_idx').on(table.triggeredByUserId),
  ],
);

export type WorkflowRun = typeof workflowRun.$inferSelect;
export type NewWorkflowRun = typeof workflowRun.$inferInsert;
