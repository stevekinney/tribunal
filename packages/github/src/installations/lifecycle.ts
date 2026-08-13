/**
 * Installation lifecycle event handlers.
 *
 * Handles installation deletion, suspension, unsuspension, and repository removal.
 * Cancels active workflows when installations or repositories become unavailable.
 */

import { isWeftFault } from '@lostgradient/weft';
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import {
  isWorkflowCancellationReason,
  type GithubServiceContext,
  type WorkflowCancellationResult,
} from '../context.js';
import {
  pullRequestReviewRun,
  repository,
  reviewIntent,
  tribunalRun,
} from '@tribunal/database/schema';
import { workflowRun, type WorkflowPhase } from '@tribunal/database/schema';
import { deleteInstallation, getInstallationById, updateInstallationStatus } from './records.js';
import { markInstallationRepositoryInactive } from '../repositories/service.js';
import { buildPullRequestOrchestratorWorkflowId } from '../pull-requests/state/workflow-signals.js';

/** True when a Weft error means the target workflow run does not exist. */
function isWorkflowNotFound(error: unknown): boolean {
  return isWeftFault(error, 'WorkflowNotFoundError');
}

/**
 * Cancel running Weft workflows by their stable id, directly through the durable
 * engine. The ported `pull-request-orchestrator` / `installation-sync` runs live
 * in Weft storage under deterministic ids and are NOT enumerated in
 * `workflow_run`, so the `workflow_run`-based cancellation path cannot reach
 * them — this closes that teardown gap. A missing run (already terminal, or no
 * engine configured) is treated as success: there is nothing to cancel.
 */
async function cancelWeftWorkflowsById(
  context: GithubServiceContext,
  workflowIds: string[],
  reason: string | undefined,
  userId: number,
): Promise<WorkflowCancellationResult> {
  if (workflowIds.length === 0) {
    return { cancelled: 0, failed: 0, errors: [] };
  }
  if (context.cancelWorkflowsById !== undefined) {
    return context.cancelWorkflowsById(
      workflowIds,
      isWorkflowCancellationReason(reason) ? reason : undefined,
      userId,
    );
  }
  return {
    cancelled: 0,
    failed: workflowIds.length,
    errors: workflowIds.map(
      (workflowId) => `${workflowId}: User-scoped workflow cancellation is not configured.`,
    ),
  };
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Workflow phases eligible for cancellation when installations/repositories are removed.
 * Includes 'pending' (queued but not started) but excludes 'cleanup' (already finishing).
 *
 * Note: This differs from `isActivePhase` in `$lib/workflows/phases` which defines
 * phases that show "Running" in the UI (excludes 'pending', includes 'cleanup').
 */
const CANCELLABLE_PHASES: WorkflowPhase[] = [
  'pending',
  'provisioning',
  'cloning',
  'executing',
  'capturing',
];

// =============================================================================
// Types
// =============================================================================

interface CancellationResult {
  cancelled: number;
  failed: number;
  errors: string[];
}

// =============================================================================
// Installation Lifecycle Handlers
// =============================================================================

/**
 * Handle installation.deleted webhook event.
 *
 * Flow:
 * 1. Cancel all active workflows for repositories under this installation
 * 2. Delete the installation record (cascade deletes installation-repository links)
 */
export async function handleInstallationDeleted(
  context: GithubServiceContext,
  installationId: number,
): Promise<void> {
  console.log('[lifecycle] Handling installation deleted', { installationId });
  const installation = await getInstallationById(context, installationId);

  // Get repositories for this installation before deletion
  const repositories = await context.db
    .select({ id: repository.id })
    .from(repository)
    .where(eq(repository.installationId, installationId));

  const repositoryIds = repositories.map((r) => r.id);

  // Cancel active workflows
  if (repositoryIds.length > 0 && installation?.userId != null) {
    const result = await cancelWorkflowsForRepositories(
      context,
      repositoryIds,
      'installation_deleted',
      installation.userId,
    );
    console.log('[lifecycle] Cancelled workflows for deleted installation', {
      installationId,
      repositoryCount: repositoryIds.length,
      ...result,
    });
    if (result.failed > 0) {
      throw new Error(
        `Failed to cancel ${result.failed} workflow(s) for deleted installation: ${result.errors.join('; ')}`,
      );
    }
  }

  // Cancel the per-installation sync workflow in the engine process that owns
  // the run before deleting the installation row it would otherwise act on.
  await context.cancelInstallationSync?.(installationId);

  // Delete the installation (cascades to installation-repository links)
  await deleteInstallation(context, installationId);

  console.log('[lifecycle] Installation deleted', { installationId });
}

/**
 * Handle installation.suspend webhook event.
 *
 * Flow:
 * 1. Update installation status to 'suspended'
 * 2. Do NOT cancel active workflows - they can complete with existing tokens
 *
 * Rationale for not cancelling workflows:
 * - Suspension is often temporary (billing issues, rate limit exceeded)
 * - Active workflows have already obtained installation tokens
 * - Gating checks prevent NEW triggers while suspended
 * - Cancelling mid-execution would waste work already done
 *
 * If the installation is later deleted, handleInstallationDeleted will cancel
 * any remaining active workflows at that time.
 */
export async function handleInstallationSuspend(
  context: GithubServiceContext,
  installationId: number,
  reason?: string,
): Promise<void> {
  console.log('[lifecycle] Handling installation suspend', { installationId, reason });

  await updateInstallationStatus(
    context,
    installationId,
    'suspended',
    reason ?? 'Suspended by GitHub',
  );

  // Log active workflow count for observability (not cancelled — see rationale above)
  const repositories = await context.db
    .select({ id: repository.id })
    .from(repository)
    .where(eq(repository.installationId, installationId));

  if (repositories.length > 0) {
    const repositoryIds = repositories.map((r) => r.id);
    const activeWorkflows = await context.db
      .select({ id: workflowRun.id })
      .from(workflowRun)
      .where(
        and(
          inArray(workflowRun.repositoryId, repositoryIds),
          inArray(workflowRun.phase, CANCELLABLE_PHASES),
        ),
      );

    if (activeWorkflows.length > 0) {
      console.warn('[lifecycle] Installation suspended with active workflows', {
        installationId,
        activeWorkflowCount: activeWorkflows.length,
      });
    }
  }

  console.log('[lifecycle] Installation suspended', { installationId });
}

/**
 * Handle installation.unsuspend webhook event.
 *
 * Flow:
 * 1. Update installation status to 'active'
 */
export async function handleInstallationUnsuspend(
  context: GithubServiceContext,
  installationId: number,
): Promise<void> {
  console.log('[lifecycle] Handling installation unsuspend', { installationId });

  await updateInstallationStatus(context, installationId, 'active');

  console.log('[lifecycle] Installation unsuspended', { installationId });
}

/**
 * Handle installation_repositories.removed webhook event.
 *
 * Flow:
 * 1. Mark repositories as inactive in installation
 * 2. Cancel active workflows for the removed repositories
 */
export async function handleRepositoriesRemoved(
  context: GithubServiceContext,
  installationId: number,
  repositoryIds: number[],
): Promise<void> {
  if (repositoryIds.length === 0) {
    return;
  }

  console.log('[lifecycle] Handling repositories removed', {
    installationId,
    repositoryCount: repositoryIds.length,
  });
  const installation = await getInstallationById(context, installationId);

  // Mark repositories as inactive
  await Promise.all(
    repositoryIds.map((repoId) =>
      markInstallationRepositoryInactive(context, installationId, repoId),
    ),
  );

  // Cancel active workflows for these repositories
  const result =
    installation?.userId == null
      ? { cancelled: 0, failed: 0, errors: [] }
      : await cancelWorkflowsForRepositories(
          context,
          repositoryIds,
          'repository_removed',
          installation.userId,
        );
  if (result.failed > 0) {
    throw new Error(
      `Failed to cancel ${result.failed} workflow(s) for removed repositories: ${result.errors.join('; ')}`,
    );
  }

  console.log('[lifecycle] Repositories removed', {
    installationId,
    repositoryCount: repositoryIds.length,
    ...result,
  });
}

// =============================================================================
// Workflow Cancellation
// =============================================================================

/**
 * Cancel all active workflows for specific repositories.
 */
export async function cancelWorkflowsForRepositories(
  context: GithubServiceContext,
  repositoryIds: number[],
  reason: string,
  userId?: number,
): Promise<CancellationResult> {
  if (repositoryIds.length === 0) {
    return { cancelled: 0, failed: 0, errors: [] };
  }

  // Find active workflows recorded in the workflow_run read-model.
  const activeWorkflows = await context.db
    .select({
      id: workflowRun.id,
      workflowId: workflowRun.workflowId,
      phase: workflowRun.phase,
    })
    .from(workflowRun)
    .where(
      and(
        inArray(workflowRun.repositoryId, repositoryIds),
        inArray(workflowRun.phase, CANCELLABLE_PHASES),
        ...(userId === undefined ? [] : [eq(workflowRun.triggeredByUserId, userId)]),
      ),
    );

  const runResult = await cancelWorkflows(context, activeWorkflows, reason);

  // Review workflow ids are shared by repository and pull request, so only
  // derive ids from active runs owned by the installation's Tribunal user.
  const activeReviews =
    userId === undefined
      ? []
      : await context.db
          .select({
            repositoryId: pullRequestReviewRun.repositoryId,
            prNumber: pullRequestReviewRun.prNumber,
          })
          .from(tribunalRun)
          .innerJoin(pullRequestReviewRun, eq(pullRequestReviewRun.runId, tribunalRun.id))
          .where(
            and(
              eq(tribunalRun.userId, userId),
              inArray(tribunalRun.repositoryId, repositoryIds),
              or(
                inArray(tribunalRun.status, ['queued', 'running']),
                and(eq(tribunalRun.status, 'cancelled'), isNotNull(tribunalRun.error)),
                and(isNotNull(tribunalRun.sandboxId), ne(tribunalRun.sandboxId, '')),
              ),
            ),
          );
  const claimedIntents =
    userId === undefined
      ? []
      : await context.db
          .select({ repositoryId: reviewIntent.repositoryId, prNumber: reviewIntent.prNumber })
          .from(reviewIntent)
          .where(
            and(
              eq(reviewIntent.userId, userId),
              inArray(reviewIntent.repositoryId, repositoryIds),
              isNotNull(reviewIntent.claimedAt),
              isNull(reviewIntent.processedAt),
            ),
          );
  const orchestratorIds = [
    ...new Set(
      [...activeReviews, ...claimedIntents].map((review) =>
        buildPullRequestOrchestratorWorkflowId(review.repositoryId, review.prNumber),
      ),
    ),
  ];
  const orchestratorResult =
    userId === undefined
      ? { cancelled: 0, failed: 0, errors: [] }
      : await cancelWeftWorkflowsById(context, orchestratorIds, reason, userId);

  return {
    cancelled: runResult.cancelled + orchestratorResult.cancelled,
    failed: runResult.failed + orchestratorResult.failed,
    errors: [...runResult.errors, ...orchestratorResult.errors],
  };
}

/**
 * Cancel a list of workflows.
 *
 * Cancels the running Weft workflow (via the durable engine) and then marks the
 * local `workflow_run` observability row `cancelled`. The engine cancel is
 * best-effort relative to the DB write: a missing run (already terminal, or
 * never started because storage is unconfigured) is treated as success — there
 * is nothing to cancel — so the local row is still reconciled to `cancelled`.
 *
 * Durable resource teardown (weft#446): when a workflow holds an external paid
 * resource (e.g. an E2B sandbox), `client.cancel(id)` alone is not enough — the
 * resource must be torn down even across a crash. 0.4.0 ships the mechanism: a
 * definition-level `finalizer` activity driven post-terminal, fed by
 * `ctx.setFinalizerState(resourceId)`. Tribunal's current activities
 * (analyzePullRequest, syncRepositories) hold NO external resources, so no
 * finalizer is registered yet. When a sandbox-holding activity lands, give its
 * workflow a `finalizer` and call `ctx.setFinalizerState` after acquiring the
 * resource; cancellation here then drives durable teardown automatically.
 * https://github.com/stevekinney/weft/issues/446
 */
async function cancelWorkflows(
  context: GithubServiceContext,
  workflows: { id: string; workflowId: string; phase: WorkflowPhase }[],
  reason: string,
): Promise<CancellationResult> {
  if (workflows.length === 0) {
    return { cancelled: 0, failed: 0, errors: [] };
  }

  let remotelyFailedWorkflowIds = new Set<string>();
  let remoteFailure: Pick<CancellationResult, 'failed' | 'errors'> | undefined;
  if (context.cancelWorkflowsById !== undefined) {
    const requestedWorkflowIds = new Set(workflows.map((workflow) => workflow.workflowId));
    const cancellation = await context.cancelWorkflowsById(
      workflows.map((workflow) => workflow.workflowId),
    );
    if (cancellation.failed > 0) {
      remotelyFailedWorkflowIds = workflowIdsFromCancellationErrors(cancellation.errors);
      remoteFailure = { failed: cancellation.failed, errors: cancellation.errors };
      const hasOnlyKnownFailedWorkflowIds = [...remotelyFailedWorkflowIds].every((workflowId) =>
        requestedWorkflowIds.has(workflowId),
      );
      if (remotelyFailedWorkflowIds.size === 0 || !hasOnlyKnownFailedWorkflowIds) {
        return {
          cancelled: 0,
          failed: cancellation.failed,
          errors: cancellation.errors,
        };
      }
    }
  }

  let cancelled = 0;
  let failed = 0;
  const errors: string[] = [];

  // Resolve the durable client once for local/default batches. Null when no
  // local engine is configured (WEFT_DATABASE_URL unset) — the local rows are
  // still reconciled. Production web supplies `cancelWorkflowsById` instead,
  // which must report delivery failures instead of silently succeeding.
  const client =
    context.cancelWorkflowsById === undefined
      ? await context.resolveWeftClient?.().catch(() => null)
      : null;

  for (const workflow of workflows) {
    try {
      if (remotelyFailedWorkflowIds.has(workflow.workflowId)) {
        continue;
      }

      // Cancel the running Weft workflow before marking the row cancelled. A
      // missing run (WorkflowNotFoundError) means there is nothing to cancel —
      // not an error — so we proceed to reconcile the local row regardless.
      if (client) {
        try {
          await client.cancel(workflow.workflowId);
        } catch (cancelError) {
          if (!isWorkflowNotFound(cancelError)) {
            throw cancelError;
          }
        }
      }

      // Update database record only if still in an active phase
      // This prevents overwriting workflows that completed/failed during the cancellation process
      const updateResult = await context.db
        .update(workflowRun)
        .set({
          phase: 'cancelled',
          cancellationReason: reason,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(eq(workflowRun.id, workflow.id), inArray(workflowRun.phase, CANCELLABLE_PHASES)),
        );

      // Check if the update actually modified a row
      // Note: Neon uses `rowCount`, PGlite uses `affectedRows`
      const affectedRows =
        (updateResult as { rowCount?: number }).rowCount ??
        (updateResult as { affectedRows?: number }).affectedRows ??
        0;
      if (affectedRows > 0) {
        cancelled++;
      } else {
        // Workflow already transitioned to a terminal state, skip
        console.log('[lifecycle] Workflow already completed, skipping cancellation', {
          workflowId: workflow.workflowId,
          originalPhase: workflow.phase,
        });
      }
    } catch (error) {
      failed++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`${workflow.workflowId}: ${errorMessage}`);
      console.error('[lifecycle] Failed to cancel workflow', {
        workflowId: workflow.workflowId,
        error: errorMessage,
      });
    }
  }

  return {
    cancelled,
    failed: failed + (remoteFailure?.failed ?? 0),
    errors: [...errors, ...(remoteFailure?.errors ?? [])],
  };
}

function workflowIdsFromCancellationErrors(errors: string[]): Set<string> {
  const workflowIds = new Set<string>();
  for (const error of errors) {
    const separatorIndex = error.indexOf(': ');
    if (separatorIndex > 0) workflowIds.add(error.slice(0, separatorIndex));
  }
  return workflowIds;
}
