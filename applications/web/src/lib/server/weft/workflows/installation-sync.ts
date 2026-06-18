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
 * Status transitions written to the database by THIS flow:
 *   - 'in_progress' (before each sync attempt — set in syncRepositories)
 *   - 'idle'        (on success — set inside refreshInstallationRepositories)
 *   - 'failed'      (on error — set in the catch branch of syncRepositories;
 *                    and on cancel/timeout by the finalizer below)
 *
 * Note: the `sync_status` enum also defines 'pending', but nothing in the sync
 * flow writes it — `enqueueInstallationSync` only `startOrSignal`s, it does not
 * pre-mark the row. (This is why the finalizer's WHERE matches only 'in_progress';
 * see reconcileSyncStatusOnTeardown.)
 *
 * Durable finalizer (weft#446): on a CANCELLED or TIMED-OUT terminal — e.g. a
 * lease eviction (weft#470) deposing this engine mid-sync, lifecycle teardown
 * cancelling the run, or the activity exhausting its timeout — the engine drives
 * `reconcileSyncStatusOnTeardown` post-terminal. Without it a row could be left
 * stuck at 'in_progress' forever (a perpetual spinner in the UI). The finalizer
 * flips only a row still showing this run's 'in_progress' to 'failed' with an
 * explanatory error, leaving an already-settled 'idle'/'failed' row untouched.
 * `completed`/`failed` workflow terminals never run it. The workflow records its
 * finalizer payload via
 * `ctx.setFinalizerState({ installationId })` immediately on entry so the
 * installation id is durable before any cancellable work begins.
 */

import { workflow, signal, activity } from '@lostgradient/weft';
import { and, eq } from 'drizzle-orm';
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
 *
 * Cooperative cancellation (0.5.0): the activity receives an `AbortSignal` that
 * fires on workflow cancel/timeout. We check it ONCE, BEFORE any side effect, so
 * a run cancelled during the leading debounce never starts a sync and never
 * writes the `in_progress`/`idle` state that would mask the finalizer's `failed`.
 * We deliberately do NOT re-check after a successful fetch: at that point the
 * repositories ARE synced and `idle` is correct, so a late cancel is not a data
 * problem and must not be turned into a spurious `failed`.
 *
 * Residual hard-guarantee gap (best-effort, not airtight): if a cancel lands
 * while `refreshInstallationRepositories` is mid-fetch, that function may still
 * write `idle` internally before returning, leaving a stale `idle` for a run that
 * was cancelled mid-flight (the finalizer's `eq(in_progress)` WHERE then matches
 * nothing). Fully closing this needs a durable per-attempt generation token
 * shared by the activity's success write and the finalizer — tracked as a
 * pre-production gate in WEFT_MIGRATION_PLAN.md §7; inert today since the engine
 * only runs when WEFT_DATABASE_URL is set.
 */
export async function syncRepositories(
  input: { installationId: number },
  context?: { signal: AbortSignal },
): Promise<{
  repositoryCount: number;
  deactivatedRepositoryCount: number;
}> {
  const { installationId } = input;

  // Bail before any side effect if this run was already cancelled (e.g. cancelled
  // during the leading debounce). Throwing here means the workflow treats the run
  // as failed and the finalizer's 'failed' stands, rather than this activity
  // writing 'in_progress'/'idle' over it.
  context?.signal.throwIfAborted();

  // Mark in-progress before hitting GitHub API so the UI reflects active work.
  await githubContext.db
    .update(githubInstallation)
    .set({ syncStatus: 'in_progress', updatedAt: new Date() })
    .where(eq(githubInstallation.installationId, installationId));

  try {
    const result = await refreshInstallationRepositories(githubContext, installationId);
    // refreshInstallationRepositories already set syncStatus = 'idle' on success.
    // We deliberately do NOT re-check the abort signal here: a cancel arriving
    // AFTER a successful fetch is not a data problem — the repositories ARE synced
    // and 'idle' is the correct status. Throwing here would route into the catch
    // below and overwrite 'idle' with a spurious 'failed' for a run that actually
    // completed. The leading throwIfAborted (above, before any write) is what
    // matters: it stops a run cancelled during the debounce from starting.
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

/** Payload staged via ctx.setFinalizerState and handed to the finalizer. */
type SyncFinalizerState = { installationId: number };

/**
 * Finalizer: reconcile a stranded sync status after a cancelled/timed-out
 * terminal (weft#446).
 *
 * Runs ONLY when the workflow is cancelled or times out (never on normal
 * completion), and only because the workflow staged finalizer state on entry. A
 * sync that is interrupted mid-flight — lease eviction, lifecycle teardown, or a
 * timeout — can leave `syncStatus` stuck at 'pending'/'in_progress'. This flips
 * such a row to 'failed' so the UI/operator sees an interrupted sync rather than
 * a perpetual spinner.
 *
 * Idempotent by construction (the finalizer "runs at least once and must be
 * idempotent"): the update is conditional on the row STILL being 'in_progress'.
 * A second invocation, or a sync that finished as 'idle'/'failed' before teardown
 * landed, matches no rows and is a no-op — so a genuine success is never
 * clobbered.
 *
 * Why only 'in_progress' (not also 'pending'): 'in_progress' is written solely by
 * THIS run's syncRepositories, so matching it cannot touch another run's state.
 * 'pending' is deliberately excluded — nothing in the sync flow writes 'pending'
 * today (enqueueInstallationSync only startOrSignals; it does not pre-mark the
 * row), so matching it would only risk failing a hypothetical future
 * producer-set 'pending' belonging to a SUCCESSOR run. A run cancelled during the
 * leading debounce (before syncRepositories writes 'in_progress') therefore leaves
 * the row at whatever its prior terminal value was, which is correct — no stranded
 * spinner, since no in-progress state was ever shown for this run.
 *
 * Residual hard-guarantee gap: this no-clobber rests on Weft blocking a fresh
 * same-id run while teardown is pending AND on syncRepositories' cooperative
 * abort. A durable per-attempt generation token (shared by the activity's success
 * write and this WHERE) would make it airtight; see WEFT_MIGRATION_PLAN.md §7.
 */
export async function reconcileSyncStatusOnTeardown(state: SyncFinalizerState): Promise<void> {
  const { installationId } = state;

  await githubContext.db
    .update(githubInstallation)
    .set({
      syncStatus: 'failed',
      // Covers all non-completion terminals the finalizer fires on: a deliberate
      // lifecycle teardown (installation removed), a lease eviction stopping the
      // engine, and an activity timeout — without asserting which one occurred.
      syncError: 'Sync interrupted before completion (cancelled, stopped, or timed out).',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(githubInstallation.installationId, installationId),
        // Conditional: only reconcile a row still showing THIS run's 'in_progress'.
        // Leaves a settled 'idle'/'failed' row untouched (idempotency + no clobber).
        eq(githubInstallation.syncStatus, 'in_progress'),
      ),
    );
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
export const installationSyncWorkflow = workflow({
  name: 'installation-sync',
  // Durable teardown on cancel/timeout (weft#446). The engine drives this with
  // retry/backoff and re-drives it on crash recovery; it sees the
  // ctx.setFinalizerState payload recorded on entry. The finalizer is a standalone
  // activity definition (built via activity()), distinct from the .activities()
  // map below.
  finalizer: activity({
    name: 'reconcileSyncStatusOnTeardown',
    execute: reconcileSyncStatusOnTeardown,
    timeout: '1m',
  }),
})
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

    // Record the finalizer payload BEFORE any cancellable work, so a cancel /
    // timeout / lease eviction arriving during the debounce or the sync still has
    // a durable installationId to reconcile (weft#446). Recording is what arms the
    // finalizer at all — if it is never called, the engine skips teardown.
    ctx.setFinalizerState({ installationId } satisfies SyncFinalizerState);

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
