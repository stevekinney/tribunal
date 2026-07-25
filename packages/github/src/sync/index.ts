/**
 * GitHub sync job queue.
 *
 * This module provides the interface for enqueuing GitHub sync operations.
 * These functions dispatch to the registered `installation-sync` Weft workflow.
 * Callers remain fire-and-forget, but a missing receiver is reported as an
 * observable error result instead of a successful no-op.
 *
 * Terminal-restart semantics (weft#604, shipped in 0.7.0): periodic re-sync
 * reuses a stable workflow id (`github:installations:{id}:sync`). Passing
 * `onTerminalConflict: 'start-new'` in the `startOrSignal` options tells the
 * engine to purge-and-restart a terminal run atomically rather than rejecting
 * it as a conflict, so a re-sync after a clean terminal no longer drops the
 * dispatch.
 */

import { isWeftFault } from '@lostgradient/weft';
import type { WeftClient } from '@lostgradient/weft/client';
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
 * Temporal's signalWithStart). When no receiver is configured, it reports an
 * error so the caller can make the failed handoff visible.
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
      return {
        workflowId,
        status: 'error',
        error: 'Installation sync receiver is not configured.',
      };
    }

    return await dispatchInstallationSync(client, options);
  } catch (error) {
    if (isWeftFault(error, 'WorkflowNotRegisteredError')) {
      return {
        workflowId,
        status: 'error',
        error: 'installation-sync is not registered on the receiver.',
      };
    }
    return {
      workflowId,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function dispatchInstallationSync(
  client: WeftClient,
  options: EnqueueInstallationSyncOptions,
): Promise<EnqueueInstallationSyncResult> {
  const workflowId = `github:installations:${options.installationId}:sync`;
  await client.startOrSignal(
    'installation-sync',
    options,
    {
      name: 'sync_requested',
      payload: options,
      signalId: options.deliveryId ?? crypto.randomUUID(),
    },
    {
      id: workflowId,
      onTerminalConflict: 'start-new',
    },
  );
  return { workflowId, status: 'started' };
}
