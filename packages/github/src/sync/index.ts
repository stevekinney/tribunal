/**
 * GitHub sync job queue.
 *
 * This module provides the interface for enqueuing GitHub sync operations.
 * The workflow runtime that previously executed the sync has been removed, so
 * these functions log the work that would have been enqueued and report a
 * started status. Callers remain fire-and-forget.
 *
 * TODO(weft): Replace this log-only shim with a ../weft-backed installation
 * sync workflow using the same start-or-signal shape that Depict used with
 * Temporal's signalWithStart.
 */

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
 * Fire-and-forget: returns a result object instead of throwing. The workflow
 * dispatch has been removed; this logs what would have been enqueued.
 */
export async function enqueueInstallationSync(
  _context: GithubServiceContext,
  options: EnqueueInstallationSyncOptions,
): Promise<EnqueueInstallationSyncResult> {
  const workflowId = `github:installations:${options.installationId}:sync`;

  console.log('[sync] would enqueue installation sync', {
    workflowId,
    installationId: options.installationId,
    reason: options.reason,
    triggeredByUserId: options.triggeredByUserId,
  });

  return { workflowId, status: 'started' };
}
