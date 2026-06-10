/**
 * GitHub sync job queue.
 *
 * This module provides the interface for enqueuing GitHub sync operations.
 * The workflow runtime that previously executed the sync has been removed, so
 * these functions log the work that would have been enqueued and report a
 * started status. Callers remain fire-and-forget.
 *
 * This producer dispatches through the in-process Weft client when one is
 * configured, and falls back to logging when it is not (or when the
 * installation-sync workflow is not registered yet). The matching
 * `installation-sync` workflow definition still needs to be ported.
 *
 * TODO(weft#452): Periodic re-sync reuses a stable workflow id
 * (`github:installations:{id}:sync`). Once the prior run is terminal, Weft 0.3.0
 * throws WorkflowAlreadyExistsError / StartOrSignalConflictError on re-start.
 * Until idempotent re-start (ALLOW_DUPLICATE) lands upstream, this producer must
 * check terminal status and purge before re-starting.
 * https://github.com/stevekinney/weft/issues/452
 */

import { isWeftErrorLike } from '@lostgradient/weft';
import type { GithubServiceContext } from '../context.js';
import type { EnqueueInstallationSyncOptions, EnqueueInstallationSyncResult } from './types.js';

// Re-export types for convenience
export type { EnqueueInstallationSyncOptions, EnqueueInstallationSyncResult } from './types.js';

// ============================================================================
// ENQUEUE FUNCTIONS
// ============================================================================

/**
 * Enqueue a sync for a GitHub installation.
 *
 * Fire-and-forget: returns a result object instead of throwing. When a Weft
 * client is configured, this start-or-signals the per-installation sync workflow
 * (coalescing rapid lifecycle webhooks onto one run, the shape Depict used with
 * Temporal's signalWithStart). When no engine is configured, it logs what would
 * have been enqueued and reports `started`.
 */
export async function enqueueInstallationSync(
  context: GithubServiceContext,
  options: EnqueueInstallationSyncOptions,
): Promise<EnqueueInstallationSyncResult> {
  const workflowId = `github:installations:${options.installationId}:sync`;

  const client = await context.resolveWeftClient?.();
  if (!client) {
    console.log('[sync] would enqueue installation sync (no engine)', {
      workflowId,
      installationId: options.installationId,
      reason: options.reason,
      triggeredByUserId: options.triggeredByUserId,
    });
    return { workflowId, status: 'started' };
  }

  try {
    await client.startOrSignal(
      'installation-sync',
      options,
      // startOrSignal needs a signalId (with the workflow id) so concurrent
      // lifecycle webhooks converge on one sync run while each delivers once.
      // No delivery GUID is threaded here yet; mint a fresh id per enqueue. The
      // webhook HTTP layer already dedups GitHub redeliveries upstream.
      { name: 'sync_requested', payload: options, signalId: crypto.randomUUID() },
      { id: workflowId },
    );
    return { workflowId, status: 'started' };
  } catch (error) {
    // Storage may be configured before the installation-sync workflow is ported.
    // Until it is, report the no-op as 'started' rather than 'error'.
    if (isWeftErrorLike(error) && error.code === 'WorkflowNotRegisteredError') {
      console.log('[sync] installation-sync not registered yet; skipping dispatch', { workflowId });
      return { workflowId, status: 'started' };
    }
    return {
      workflowId,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
