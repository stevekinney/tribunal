/**
 * Weft durable workflow: installation-sync
 *
 * Coalesces rapid GitHub lifecycle webhooks (installation.created,
 * installation_repositories.added, etc.) onto a single sync run per
 * installation. Signal coalescing uses a leading-sleep debounce: the workflow
 * sleeps 15 s on entry so bursts of webhooks accumulate as buffered signals
 * before the first sync executes.
 *
 * Loop shape (ported from depict's Temporal installationSyncWorkflow, adapted
 * to drain BEFORE each sync rather than only after):
 *   1. Sleep 15 s (debounce — lets rapid signals accumulate).
 *   2. Drain every sync_requested signal already buffered — this includes the
 *      initiating signal from startOrSignal's creation batch plus anything
 *      that arrived during the debounce. The sync about to run satisfies all
 *      of them, since it re-reads live installation state from the GitHub
 *      API rather than working off a stale input snapshot.
 *   3. Run the sync activity (refreshInstallationRepositories).
 *   4. Non-blocking drain race: did a sync_requested arrive DURING the sync?
 *      Only signals that arrive after step 2 need a further pass, so drain the
 *      whole buffer again — N signals collapse into one additional pass, not
 *      N. If a signal was seen, loop. If not, return. Weft #693 (0.11.0) made
 *      signal delivery serialize against terminal completion, so a signal
 *      arriving after this drain check but before the run commits terminal
 *      state is handed to a successor run rather than lost — see the drain
 *      race below.
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
 * Weft 0.9 also passes owner tokens to the activity and finalizer; activity
 * settlement requires the workflow execution token plus the activity attempt
 * token recorded by syncRepositories. Finalizer cleanup requires the workflow
 * execution token, a pre-token NULL fallback, or a stale row whose sync start
 * time predates the finalizing workflow run. The finalizer leaves owner tokens in
 * place so a concurrently finishing activity can still prove ownership and
 * settle a completed repository sync back to 'idle'.
 * `completed`/`failed` workflow terminals never run it. The workflow records its
 * finalizer payload via `ctx.setFinalizerState({ installationId, workflowStartedAt })`
 * immediately on entry so the installation id and stale-row cutoff are durable
 * before any cancellable work begins.
 */

import {
  workflow,
  signal,
  activity,
  type ActivityContext,
  type WorkflowContext,
} from '@lostgradient/weft';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
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

// ============================================================================
// DEBOUNCE CONSTANTS
// ============================================================================

/** Leading-sleep debounce window. Matches depict's DEBOUNCE_MS=15000. */
const DEBOUNCE_DURATION = '15s';

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
 * Weft 0.9 execution tokens harden the late-cancel path: the activity records
 * both the workflow execution token and the activity attempt token with
 * 'in_progress'. Success/failure writes from this activity attempt require both
 * tokens, so a stale retry attempt cannot clear a newer attempt's ownership.
 */
export async function syncRepositories(
  input: { installationId: number },
  context?: ActivityContext,
): Promise<{
  repositoryCount: number;
  deactivatedRepositoryCount: number;
}> {
  const { installationId } = input;
  const syncWorkflowExecutionToken = context?.workflowExecutionToken;
  const syncActivityAttemptToken = context?.activityAttemptToken;
  if ((syncWorkflowExecutionToken === undefined) !== (syncActivityAttemptToken === undefined)) {
    throw new Error('Installation sync requires workflow and activity attempt tokens together.');
  }

  // Bail before any side effect if this run was already cancelled (e.g. cancelled
  // during the leading debounce). Throwing here means the workflow treats the run
  // as failed and the finalizer's 'failed' stands, rather than this activity
  // writing 'in_progress'/'idle' over it.
  context?.signal.throwIfAborted();

  // Mark in-progress before hitting GitHub API so the UI reflects active work.
  const claimStartedAt = new Date();
  await githubContext.db
    .update(githubInstallation)
    .set({
      syncStatus: 'in_progress',
      syncStartedAt: claimStartedAt,
      syncWorkflowExecutionToken: syncWorkflowExecutionToken ?? null,
      syncActivityAttemptToken: syncActivityAttemptToken ?? null,
      updatedAt: claimStartedAt,
    })
    .where(
      buildActivityClaimPredicate(
        installationId,
        syncWorkflowExecutionToken,
        syncActivityAttemptToken,
      ),
    );

  try {
    const refreshOptions =
      syncWorkflowExecutionToken === undefined || syncActivityAttemptToken === undefined
        ? {}
        : { syncWorkflowExecutionToken, syncActivityAttemptToken };
    const result = await refreshInstallationRepositories(
      githubContext,
      installationId,
      refreshOptions,
    );
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
        syncStartedAt: null,
        syncWorkflowExecutionToken: null,
        syncActivityAttemptToken: null,
        updatedAt: new Date(),
      })
      .where(
        buildActivitySyncPredicate(
          installationId,
          syncWorkflowExecutionToken,
          syncActivityAttemptToken,
        ),
      );

    throw error;
  }
}

/**
 * Drain every sync_requested signal already sitting in the durable buffer,
 * non-blocking. Races a direct `ctx.waitForSignal('sync_requested')` against a
 * literal `ctx.sleep(0)`: Weft checks the durable signal buffer first and
 * consumes one already-buffered signal if present, otherwise the zero-duration
 * sleep wins immediately. Repeating this until the sleep wins drains the WHOLE
 * buffer in one pass — a burst of N buffered signals is consumed here, not one
 * at a time across N loop iterations.
 *
 * Returns whether at least one signal was consumed, so the caller can decide
 * whether another sync pass is warranted.
 */
function* drainBufferedSignals(ctx: WorkflowContext): Generator<unknown, boolean, unknown> {
  let sawSignal = false;
  while (true) {
    const drainResult = yield* ctx.race([
      ctx.waitForSignal('sync_requested'),
      ctx.sleep(0),
    ] as const);
    if (drainResult === undefined) {
      return sawSignal;
    }
    sawSignal = true;
  }
}

/** Payload staged via ctx.setFinalizerState and handed to the finalizer. */
type SyncFinalizerState = { installationId: number; workflowStartedAt?: number };

/**
 * Finalizer: reconcile a stranded sync status after a cancelled/timed-out
 * terminal (weft#446).
 *
 * Runs ONLY when the workflow is cancelled or times out (never on normal
 * completion), and only because the workflow staged finalizer state on entry. A
 * sync that is interrupted after syncRepositories marks it active — lease
 * eviction, lifecycle teardown, or a timeout — can leave `syncStatus` stuck at
 * 'in_progress'. This flips such a row to 'failed' so the UI/operator sees an
 * interrupted sync rather than a perpetual spinner.
 *
 * Idempotent by construction (the finalizer "runs at least once and must be
 * idempotent"): the update is conditional on the row STILL being 'in_progress'
 * and, when Weft provides one, still carrying this run's workflow execution
 * token, and it leaves those tokens on the failed row. A NULL workflow-token
 * fallback handles rows that were already
 * in-progress before this migration deployed. A stale-row fallback handles a
 * newer run that is cancelled before it can replace an older in-progress token:
 * the finalizer may clean rows whose sync started before this workflow run
 * started, but not rows updated by a successor. If this run's sync activity finishes after the
 * finalizer, the preserved tokens let its success write settle the row to 'idle'.
 * A second invocation, a successor run, or a sync that finished as
 * 'idle'/'failed' before teardown landed matches no rows and is a no-op — so a
 * genuine success is never clobbered.
 *
 * Why only 'in_progress' (not also 'pending'): nothing in the sync flow writes
 * 'pending' today (enqueueInstallationSync only startOrSignals; it does not
 * pre-mark the row), so matching it would only risk failing a hypothetical future
 * producer-set 'pending' belonging to a successor run. A run cancelled during the
 * leading debounce (before syncRepositories writes 'in_progress') therefore
 * leaves the row at whatever its prior terminal value was, which is correct — no
 * stranded spinner, since no in-progress state was ever shown for this run.
 */
export async function reconcileSyncStatusOnTeardown(
  state: SyncFinalizerState,
  context?: ActivityContext,
): Promise<void> {
  const { installationId, workflowStartedAt } = state;
  const syncWorkflowExecutionToken = context?.workflowExecutionToken;

  await githubContext.db
    .update(githubInstallation)
    .set({
      syncStatus: 'failed',
      // Covers all non-completion terminals the finalizer fires on: a deliberate
      // lifecycle teardown (installation removed), a lease eviction stopping the
      // engine, and an activity timeout — without asserting which one occurred.
      syncError: 'Sync interrupted before completion (cancelled, stopped, or timed out).',
      syncStartedAt: null,
      updatedAt: new Date(),
    })
    .where(
      buildFinalizerSyncPredicate(installationId, syncWorkflowExecutionToken, workflowStartedAt),
    );
}

function buildActivitySyncPredicate(
  installationId: number,
  syncWorkflowExecutionToken?: string,
  syncActivityAttemptToken?: string,
) {
  const installationPredicate = eq(githubInstallation.installationId, installationId);
  const inProgressPredicate = eq(githubInstallation.syncStatus, 'in_progress');
  if (syncWorkflowExecutionToken === undefined) {
    return and(installationPredicate, inProgressPredicate);
  }

  const predicates = [
    installationPredicate,
    inProgressPredicate,
    eq(githubInstallation.syncWorkflowExecutionToken, syncWorkflowExecutionToken),
  ];
  if (syncActivityAttemptToken !== undefined) {
    predicates.push(eq(githubInstallation.syncActivityAttemptToken, syncActivityAttemptToken));
  }

  return and(...predicates);
}

function buildActivityClaimPredicate(
  installationId: number,
  syncWorkflowExecutionToken: string | undefined,
  syncActivityAttemptToken: string | undefined,
) {
  const installationPredicate = eq(githubInstallation.installationId, installationId);
  if (syncWorkflowExecutionToken === undefined || syncActivityAttemptToken === undefined) {
    return installationPredicate;
  }

  return and(
    installationPredicate,
    or(
      isNull(githubInstallation.syncWorkflowExecutionToken),
      eq(githubInstallation.syncWorkflowExecutionToken, syncWorkflowExecutionToken),
    ),
  );
}

function buildFinalizerSyncPredicate(
  installationId: number,
  syncWorkflowExecutionToken?: string,
  workflowStartedAt?: number,
) {
  const installationPredicate = eq(githubInstallation.installationId, installationId);
  const inProgressPredicate = eq(githubInstallation.syncStatus, 'in_progress');
  if (syncWorkflowExecutionToken === undefined) {
    return and(installationPredicate, inProgressPredicate);
  }

  const tokenPredicates = [
    eq(githubInstallation.syncWorkflowExecutionToken, syncWorkflowExecutionToken),
    isNull(githubInstallation.syncWorkflowExecutionToken),
  ];
  if (workflowStartedAt !== undefined) {
    tokenPredicates.push(lte(githubInstallation.syncStartedAt, new Date(workflowStartedAt)));
  }

  return and(installationPredicate, inProgressPredicate, or(...tokenPredicates));
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
    ctx.setFinalizerState({
      installationId,
      workflowStartedAt: ctx.startedAt,
    } satisfies SyncFinalizerState);

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
    // Sync loop: drain everything already buffered (it will be satisfied by
    // the sync about to run), sync, then check for signals that arrived
    // DURING the sync (non-blocking). Only those need another pass.
    // -----------------------------------------------------------------------
    while (true) {
      // Drain the whole buffer BEFORE syncing. This consumes the initiating
      // signal from startOrSignal's creation batch plus anything buffered
      // during the debounce (or, on a later iteration, during the previous
      // sync). refreshInstallationRepositories re-reads live installation
      // state from the GitHub API rather than working off a stale input
      // snapshot, so the sync about to run satisfies every drained signal —
      // draining first (once) instead of after (once per signal) is what
      // collapses a burst of N signals into a single extra pass rather than N.
      yield* drainBufferedSignals(ctx);

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

      // Non-blocking drain: did a sync_requested arrive DURING the sync we
      // just ran? Because the producer (enqueueInstallationSync) dispatches
      // via startOrSignal with a stable workflow id, a signalId (stable per
      // GitHub delivery when options.deliveryId is present, otherwise a fresh
      // UUID per call), and onTerminalConflict: 'start-new', Weft #693
      // (shipped in 0.11.0) serializes signal delivery against terminal
      // completion: a signal arriving after this empty-buffer check but
      // before the run commits terminal state is consumed by this run or
      // handed to a fresh successor run — never dropped. No positive drain
      // window is needed for correctness.
      const sawSignalDuringSync = yield* drainBufferedSignals(ctx);

      if (!sawSignalDuringSync) {
        // No signal arrived during the sync; complete the run.
        ctx.log?.info('installation-sync: no pending signals, workflow complete', {
          installationId,
        });
        return;
      }

      // A sync_requested signal arrived during the sync — loop for another
      // pass. The drain above already consumed every signal buffered so far
      // (a whole burst collapses into this one additional pass).
      ctx.log?.info('installation-sync: new signal received during sync, looping', {
        installationId,
      });

      // Short debounce between back-to-back syncs so a burst of signals
      // during an in-flight sync still coalesces before the next pass.
      yield* ctx.sleep(DEBOUNCE_DURATION);
    }
  });
