/**
 * Weft durable workflow: installation-sync
 *
 * Coalesces rapid GitHub lifecycle webhooks (installation.created,
 * installation_repositories.added, etc.) onto a single sync run per
 * installation. Signal coalescing uses a leading-sleep debounce: the workflow
 * sleeps 15 s on entry so bursts of webhooks accumulate as buffered signals
 * before the first sync executes.
 *
 * Loop shape (ported from depict's Temporal installationSyncWorkflow):
 *   1. Sleep 15 s (debounce — lets rapid signals accumulate).
 *   2. Run the sync activity (refreshInstallationRepositories).
 *   3. Non-blocking race: did another sync_requested arrive during the sleep
 *      or sync? If yes, loop for another sync. If no, return.
 *
 * continueAsNew is DROPPED intentionally. Weft's checkpoint model bounds
 * history per run; the workflow terminates naturally when the signal buffer
 * drains, so there is no history-growth hazard that requires recycling the
 * execution. A new startOrSignal for a terminal run will start a fresh
 * execution under the same stable workflow id.
 *
 * Status transitions written to the database:
 *   - 'pending'     (before debounce sleep — set by the producer via enqueueInstallationSync)
 *   - 'in_progress' (before each sync attempt)
 *   - 'idle'        (on success — set inside refreshInstallationRepositories)
 *   - 'failed'      (on error — set in the catch branch of syncRepositories)
 */

import { workflow, signal } from '@lostgradient/weft';
import { eq } from 'drizzle-orm';
import { githubInstallation } from '@tribunal/database/schema';
import { refreshInstallationRepositories } from '@tribunal/github/repositories/service';
import type { EnqueueInstallationSyncOptions } from '@tribunal/github/sync/types';
import { githubContext } from '$lib/server/github-context';

// ============================================================================
// SIGNAL DEFINITIONS
// ============================================================================

/**
 * Payload for the sync_requested signal.
 * Matches EnqueueInstallationSyncOptions so producers can forward their full
 * options object as the signal payload without a separate type.
 */
type SyncRequestedPayload = EnqueueInstallationSyncOptions;

const syncRequestedSignal = signal<SyncRequestedPayload>('sync_requested');

/**
 * True when a race winner is a sync_requested payload (a non-null object with a
 * numeric installationId) rather than the sleep-branch result (undefined).
 * Structural so it does not rely on an `=== undefined` check alone.
 */
function isSyncRequestedPayload(value: unknown): value is SyncRequestedPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { installationId?: unknown }).installationId === 'number'
  );
}

// ============================================================================
// DEBOUNCE CONSTANTS
// ============================================================================

/** Leading-sleep debounce window. Matches depict's DEBOUNCE_MS=15000. */
const DEBOUNCE_DURATION = '15s';

/**
 * Bounded window for the post-sync drain race. Long enough that a genuinely
 * buffered sync_requested signal reliably wins the race against the timer
 * (closing the sleep(0) lost-signal window), short enough that an empty buffer
 * only delays workflow completion briefly.
 */
const DRAIN_DURATION = '1s';

// ============================================================================
// ACTIVITY DEFINITIONS
// ============================================================================

/**
 * Sync repositories for the given installation.
 *
 * Wraps refreshInstallationRepositories, which:
 *   - Pages through GET /installation/repositories
 *   - Upserts repository rows and installation-repository links
 *   - Deactivates links for repositories no longer accessible
 *   - Sets githubInstallation.syncStatus = 'idle' and lastSyncedAt on success
 *
 * On failure this activity sets syncStatus = 'failed' and re-throws so the
 * workflow body can decide whether to loop or exit.
 */
async function syncRepositories(input: { installationId: number }): Promise<{
  repositoryCount: number;
  deactivatedRepositoryCount: number;
}> {
  const { installationId } = input;

  // Mark in-progress before hitting GitHub API so the UI reflects active work.
  await githubContext.db
    .update(githubInstallation)
    .set({ syncStatus: 'in_progress', updatedAt: new Date() })
    .where(eq(githubInstallation.installationId, installationId));

  try {
    const result = await refreshInstallationRepositories(githubContext, installationId);
    // refreshInstallationRepositories already sets syncStatus = 'idle' on success.
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Set failed status and preserve the error message for operator visibility.
    await githubContext.db
      .update(githubInstallation)
      .set({
        syncStatus: 'failed',
        syncError: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(githubInstallation.installationId, installationId));

    throw error;
  }
}

// ============================================================================
// WORKFLOW DEFINITION
// ============================================================================

/**
 * Installation sync workflow.
 *
 * Stable workflow id: `github:installations:{installationId}:sync`
 * Dispatched via enqueueInstallationSync (packages/github/src/sync/index.ts).
 */
export const installationSyncWorkflow = workflow({ name: 'installation-sync' })
  .activities({
    syncRepositories: {
      execute: syncRepositories,
      // Allow up to 5 minutes for GitHub API pagination across large installations.
      timeout: '5m',
    },
  })
  .signals({
    sync_requested: syncRequestedSignal,
  })
  .execute(async function* (ctx, input: EnqueueInstallationSyncOptions) {
    const { installationId } = input;

    // -----------------------------------------------------------------------
    // Debounce: sleep so rapid lifecycle webhooks accumulate as signals before
    // the first sync executes. Signals delivered during the sleep are buffered
    // by Weft and visible to the next waitForSignal.
    // -----------------------------------------------------------------------
    ctx.log?.info('installation-sync: debouncing', {
      installationId,
      reason: input.reason,
      workspaceId: input.workspaceId,
      triggeredByUserId: input.triggeredByUserId,
    });

    // Leading debounce sleep — coalesces bursts of lifecycle webhooks.
    yield* ctx.sleep(DEBOUNCE_DURATION);

    // -----------------------------------------------------------------------
    // Sync loop: run the sync, then check for buffered signals (non-blocking).
    // If a new signal arrived during the sleep or the sync itself, loop back.
    // -----------------------------------------------------------------------
    while (true) {
      ctx.log?.info('installation-sync: starting sync', { installationId });

      try {
        const result = yield* ctx.run('syncRepositories', { installationId });

        ctx.log?.info('installation-sync: sync complete', {
          installationId,
          repositoryCount: result.repositoryCount,
          deactivatedRepositoryCount: result.deactivatedRepositoryCount,
        });
      } catch (error) {
        // syncRepositories already wrote 'failed' to the DB and will have
        // been retried per the activity retry policy. Log and exit the loop
        // so the workflow completes rather than looping on a persistent error.
        ctx.log?.error('installation-sync: sync failed, exiting loop', {
          installationId,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      // Did another sync_requested arrive while we were syncing? Race the
      // signal against a SHORT bounded sleep (not sleep(0)).
      //
      // Why not sleep(0): ctx.sleep(0) is a real setTimeout(0) timer, while
      // ctx.waitForSignal is a durable-storage read. With a zero timer the read
      // can land on a later event-loop tick than the timer callback, so the
      // timer wins even when a signal IS buffered — silently dropping the sync.
      // A bounded window (DRAIN_DURATION) guarantees a genuinely-buffered signal
      // wins the race; the only cost is up to that window of tail latency before
      // the workflow exits when the buffer is truly empty.
      //
      // Note: ctx.race branches are WorkflowOperations (generators), not
      // Promises — they cannot be wrapped with .then(). The winner is the raw
      // branch value: a sync_requested payload (a non-null object) or the sleep
      // result (undefined). We discriminate on object shape, not on an
      // `=== undefined` check alone, so the guard is robust.
      // weft#456: race accepts ctx.sleep + ctx.waitForSignal branches.
      const drainResult = yield* ctx.race([
        ctx.waitForSignal('sync_requested'),
        ctx.sleep(DRAIN_DURATION),
      ] as const);

      const drainedSignal = isSyncRequestedPayload(drainResult) ? drainResult : undefined;

      if (!drainedSignal) {
        // No signal arrived within the drain window — the buffer is empty; exit.
        ctx.log?.info('installation-sync: no pending signals, workflow complete', {
          installationId,
        });
        return;
      }

      // A sync_requested signal arrived — loop for another sync pass.
      ctx.log?.info('installation-sync: new signal received, looping', {
        installationId,
        reason: drainedSignal.reason,
      });

      // Short debounce between back-to-back syncs so a burst of signals
      // during an in-flight sync still coalesces before the next pass.
      yield* ctx.sleep(DEBOUNCE_DURATION);
    }
  });
