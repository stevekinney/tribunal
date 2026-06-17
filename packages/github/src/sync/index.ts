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
 * Re-start semantics (weft#452, partially shipped in 0.4.0): periodic re-sync
 * reuses a stable workflow id (`github:installations:{id}:sync`). When the prior
 * run is terminal, `startOrSignal` reports a `Conflict`
 * (`StartOrSignalConflictError`) rather than recycling the id. 0.4.0 shipped
 * `engine.start(..., { onTerminalConflict: 'start-new' })` to purge-and-restart
 * a terminal run atomically — but that option is in-process `engine.start` ONLY;
 * it is deliberately absent from `startOrSignal` (and from `LocalClient`/REST).
 * So the coalescing `startOrSignal` path here still needs the conflict handled:
 * the installation-sync workflow loops on its own (leading-sleep debounce) and
 * stays live across coalesced webhooks, so a terminal-then-restart race is rare,
 * but a re-sync after a clean terminal must catch `StartOrSignalConflictError`
 * and either re-drive via the workflow's own loop or fall back to a fresh id.
 * Tracked as the remaining slice of weft#452.
 * https://github.com/stevekinney/weft/issues/452
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
      { id: workflowId },
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
    // Terminal-run conflict (weft#452, remaining slice): the prior sync under
    // this stable id reached a terminal state, so `startOrSignal` cannot reuse
    // the id and cannot coalesce. 0.4.0 ships purge-and-restart only on the
    // in-process `engine.start({ onTerminalConflict: 'start-new' })`, which is
    // NOT exposed on the transport-neutral `WeftClient.startOrSignal`. Until a
    // restart-capable start-or-signal lands upstream, surface this as a distinct,
    // loud error (not swallowed) so a dropped re-sync is visible to operators —
    // the caller (fireAndForgetInstallationSync) logs error results. This path
    // is inert until WEFT_DATABASE_URL is configured; see WEFT_MIGRATION_PLAN.md.
    if (isWeftFault(error, 'StartOrSignalConflictError')) {
      return {
        workflowId,
        status: 'error',
        error:
          `installation-sync id ${workflowId} has a terminal prior run; startOrSignal ` +
          `cannot restart it (weft#452 remaining slice). Re-sync was not dispatched.`,
      };
    }
    return {
      workflowId,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
