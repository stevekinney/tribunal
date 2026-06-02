/**
 * Workflow run factory for creating test workflow runs.
 */
import { workflowRun } from '@tribunal/database/schema';
import type { WorkflowRun, WorkflowPhase, WorkflowTaskType } from '@tribunal/database/schema';
import type { Database } from './core';
import { generateId } from './core';

export type WorkflowRunFactoryInput = Partial<{
  workspaceId: number;
  repositoryId: number | null;
  pullRequestNumber: number | null;
  taskType: WorkflowTaskType;
  triggerSource: string;
  phase: WorkflowPhase;
  errorMessage: string | null;
  cancellationReason: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}>;

export interface WorkflowRunFactory {
  /** Create a workflow run */
  create(input: WorkflowRunFactoryInput & { workspaceId: number }): Promise<WorkflowRun>;
  /** Create a workflow run for a specific repository */
  createForRepository(
    workspaceId: number,
    repositoryId: number,
    overrides?: Partial<WorkflowRunFactoryInput>,
  ): Promise<WorkflowRun>;
}

export function createWorkflowRunFactory(db: Database): WorkflowRunFactory {
  return {
    async create(input) {
      const id = generateId();
      const [createdWorkflowRun] = await db
        .insert(workflowRun)
        .values({
          workflowId: `workflow:${input.workspaceId}:test:${id}`,
          workspaceId: input.workspaceId,
          repositoryId: input.repositoryId ?? null,
          pullRequestNumber: input.pullRequestNumber ?? null,
          taskType: input.taskType ?? 'remediation',
          triggerSource: input.triggerSource ?? 'manual',
          phase: input.phase ?? 'pending',
          errorMessage: input.errorMessage ?? null,
          cancellationReason: input.cancellationReason ?? null,
          startedAt: input.startedAt ?? null,
          completedAt: input.completedAt ?? null,
        })
        .returning();
      return createdWorkflowRun;
    },

    async createForRepository(workspaceId, repositoryId, overrides = {}) {
      return this.create({
        workspaceId,
        repositoryId,
        ...overrides,
      });
    },
  };
}
