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
 * Terminal-restart semantics (weft#604, shipped in 0.7.0): periodic re-sync
 * reuses a stable workflow id (`github:installations:{id}:sync`). Passing
 * `onTerminalConflict: 'start-new'` in the `startOrSignal` options tells the
 * engine to purge-and-restart a terminal run atomically rather than rejecting
 * it as a conflict, so a re-sync after a clean terminal no longer drops the
 * dispatch.
 */

import { isWeftFault } from '@lostgradient/weft';
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
 *
 * Terminal prior runs are restarted atomically via `onTerminalConflict: 'start-new'`
 * (Weft ≥ 0.7.0 / weft#604), so a re-sync after a completed, failed, cancelled,
 * or timed-out sync no longer drops the dispatch.
 */
export async function enqueueInstallationSync(
  context: GithubServiceContext,
  options: EnqueueInstallationSyncOptions,
): Promise<EnqueueInstallationSyncResult> {
  const workflowId = `github:installations:${options.installationId}:sync`;

  try {
    // Resolve inside the try: a resolver failure must return a 'error' result,
    // not throw past the caller (webhook handlers and lifecycle paths).
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

    const handle = await client.startOrSignal(
      'installation-sync',
      options,
      // signalId (with the workflow id) lets concurrent lifecycle webhooks
      // converge on one sync run while each logical event delivers exactly once.
      // Use the caller's stable deliveryId (the GitHub delivery GUID) when
      // present so redeliveries/retries dedup; mint a fresh id only for distinct
      // manual/non-retryable intents that pass no deliveryId.
      {
        name: 'sync_requested',
        payload: options,
        signalId: options.deliveryId ?? crypto.randomUUID(),
      },
      {
        id: workflowId,
        // Restart terminal prior runs atomically rather than rejecting as a
        // conflict. Requires an explicit id and deterministic signal.signalId
        // (both supplied above). Shipped in @lostgradient/weft@0.7.0 (weft#604).
        onTerminalConflict: 'start-new',
      },
    );
    // weft#466: the handle reports whether this started a fresh sync run or
    // coalesced onto a live one.
    return { workflowId, status: 'started', outcome: handle.outcome };
  } catch (error) {
    // Storage may be configured before the installation-sync workflow is ported.
    // Until it is, report the no-op as 'started' rather than 'error'.
    if (isWeftFault(error, 'WorkflowNotRegisteredError')) {
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
