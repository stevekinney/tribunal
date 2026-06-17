/**
 * Installation lifecycle event handlers.
 *
 * Handles installation deletion, suspension, unsuspension, and repository removal.
 * Cancels active workflows when installations or repositories become unavailable.
 */

import { isWeftFault } from '@lostgradient/weft';
import { and, eq, inArray } from 'drizzle-orm';
import type { GithubServiceContext } from '../context.js';
import { repository } from '@tribunal/database/schema';
import { workflowRun, type WorkflowPhase } from '@tribunal/database/schema';
import { deleteInstallation, updateInstallationStatus } from './records.js';
import { markInstallationRepositoryInactive } from '../repositories/service.js';

/** True when a Weft error means the target workflow run does not exist. */
function isWorkflowNotFound(error: unknown): boolean {
  return isWeftFault(error, 'WorkflowNotFoundError');
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

  // Get repositories for this installation before deletion
  const repositories = await context.db
    .select({ id: repository.id })
    .from(repository)
    .where(eq(repository.installationId, installationId));

  const repositoryIds = repositories.map((r) => r.id);

  // Cancel active workflows
  if (repositoryIds.length > 0) {
    const result = await cancelWorkflowsForRepositories(
      context,
      repositoryIds,
      'installation_deleted',
    );
    console.log('[lifecycle] Cancelled workflows for deleted installation', {
      installationId,
      repositoryCount: repositoryIds.length,
      ...result,
    });
  }

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

  // Mark repositories as inactive
  await Promise.all(
    repositoryIds.map((repoId) =>
      markInstallationRepositoryInactive(context, installationId, repoId),
    ),
  );

  // Cancel active workflows for these repositories
  const result = await cancelWorkflowsForRepositories(context, repositoryIds, 'repository_removed');

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
): Promise<CancellationResult> {
  if (repositoryIds.length === 0) {
    return { cancelled: 0, failed: 0, errors: [] };
  }

  // Find active workflows for these repositories
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
      ),
    );

  return cancelWorkflows(context, activeWorkflows, reason);
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

  let cancelled = 0;
  let failed = 0;
  const errors: string[] = [];

  // Resolve the durable client once for the whole batch. Null when no engine is
  // configured (WEFT_DATABASE_URL unset) — the local rows are still reconciled.
  const client = await context.resolveWeftClient?.().catch(() => null);

  for (const workflow of workflows) {
    try {
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

  return { cancelled, failed, errors };
}
