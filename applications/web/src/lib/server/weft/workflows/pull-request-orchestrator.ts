/**
 * Pull request orchestrator workflow.
 *
 * One workflow per PR. Receives signals from webhooks, debounces rapid events,
 * then runs a single analyzePullRequest activity that fetches PR state, derives
 * action items, and updates the PR description.
 *
 * Key patterns:
 * - Sliding debounce: each new signal restarts the 30s clock (race-restart loop).
 * - No child workflows, no database trigger table.
 * - NO continueAsNew — Weft 0.4.0 does not have it (dropped per adaptation rules).
 * - Idle timeout (7 days): completes workflow when no events arrive for a full cycle.
 * - pullRequestClosed signal triggers one final generation-fenced analysis then
 *   completes with pr_merged or pr_closed.
 *
 * FIX 1 — RACE WINNER DISCRIMINATION:
 *   ctx.race returns the winning value, not an index; there is no keyed race API.
 *   Discriminants are embedded in each signal payload (kind: 'event' | 'closed')
 *   and the sleep branch resolves undefined. Narrowing is done via discriminant
 *   helpers below.
 *
 * FIX 2 — STALE-WRITE FENCE (weft#584):
 *   A losing ctx.run branch is NOT aborted by Weft — a superseded analysis can
 *   still complete and write stale data. The monotonic analysisGeneration counter
 *   is passed into every analyzePullRequest call; the activity compares the head
 *   SHA it fetched against the live pull_request_state.headSha before writing
 *   and skips the write if they diverge (generationFenced=true). This is the
 *   load-bearing defence, not the race abort.
 *
 * FIX 3 — SUPERSEDE CONTROL FLOW:
 *   When a pull_request_event wins the analysis race (supersede), the event IS
 *   consumed (it won). Control re-enters the DEBOUNCE phase directly (pending=r),
 *   not the wait-for-first-event phase. See: "superseding event — re-enter debounce".
 *
 * FIX 4 — analysisCount INCREMENTED AFTER SUCCESSFUL yield*:
 *   analysisCount is incremented only after the yield* ctx.run returns normally.
 *   A failed or fenced analysis never inflates the count.
 *
 * FIX 5 — IDLE TIMER SCOPE:
 *   The 7-day sleep races signals only in the wait-for-first-event phase (A).
 *   "Idle" means 7 days with no event since the last settled cycle. The 7-day
 *   branch is not present in the debounce phase (B) or analysis phase (C).
 *   Weft confirms transient in-process sleep branches are safe across loop
 *   iterations and are not durable timer rows.
 *
 * weft#456: race accepts ctx.sleep + ctx.waitForSignal branches.
 * weft#447: ctx.log?.info/.warn/.error carries workflowId/workflowType automatically.
 * weft#584: losing ctx.run branch is not aborted; generation fence is the defence.
 */

import { workflow, signal } from '@lostgradient/weft';
import { analyzePullRequest } from '../action-items/analyze-pull-request.js';
import type { AnalyzePullRequestOutput } from '../action-items/analyze-pull-request.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Sliding debounce window: 30 seconds. */
const DEBOUNCE_DURATION = '30s';

/**
 * Idle timeout: 7 days with no event since the last settled cycle.
 *
 * FIX 5: this sleep only appears in phase (A) — wait-for-first-event. A PR
 * that generates no events for 7 days after the last analysis settles is
 * considered quiescent; the workflow exits so a future startOrSignal can
 * start a fresh run.
 */
const IDLE_DURATION = '7d';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Allowed event types from webhook producers.
 * Matches SignalPullRequestEventInput.eventType in workflow-signals.ts.
 */
type PullRequestEventType =
  | 'pr_opened'
  | 'review_submitted'
  | 'review_dismissed'
  | 'review_comment_created'
  | 'review_comment_edited'
  | 'review_comment_deleted'
  | 'review_thread_resolved'
  | 'review_thread_unresolved'
  | 'issue_comment_created'
  | 'issue_comment_edited'
  | 'issue_comment_deleted'
  | 'check_completed'
  | 'base_branch_updated'
  | 'pr_closed'
  | 'manual';

/**
 * Payload carried by the pull_request_event signal.
 *
 * FIX 1: The `kind` discriminant distinguishes this from PullRequestClosedPayload
 * when ctx.race returns the winning value. Without keyed race, discrimination must
 * live in the payload itself.
 */
type PullRequestEventPayload = {
  kind: 'event';
  workspaceId: number;
  repositoryId: number;
  prNumber: number;
  installationId: number;
  owner: string;
  repo: string;
  eventType: PullRequestEventType;
  actorLogin?: string;
  eventId?: string;
};

/**
 * Payload carried by the pull_request_closed signal.
 *
 * FIX 1: The `kind` discriminant distinguishes this from PullRequestEventPayload
 * when ctx.race returns the winning value.
 */
type PullRequestClosedPayload = {
  kind: 'closed';
  merged: boolean;
  actorLogin?: string;
};

/** Input for the orchestrator workflow — mirrors SignalPullRequestEventInput. */
export type PullRequestOrchestratorInput = {
  workspaceId: number;
  repositoryId: number;
  prNumber: number;
  installationId: number;
  owner: string;
  repo: string;
};

/** Output for the orchestrator workflow. */
export type PullRequestOrchestratorOutput = {
  completed: true;
  completionReason: 'idle_timeout' | 'pr_merged' | 'pr_closed' | 'error';
  analysisCount: number;
  error?: string;
};

// ============================================================================
// RACE RESULT DISCRIMINANTS (FIX 1)
//
// ctx.race returns the winning VALUE — there is no index or keyed variant.
// The three branches resolve:
//   - pull_request_event signal  → PullRequestEventPayload  (kind: 'event')
//   - pull_request_closed signal → PullRequestClosedPayload (kind: 'closed')
//   - ctx.sleep                  → undefined
//
// These helpers narrow the winner type to the correct branch.
// ============================================================================

// The race winner is discriminated by the guards below, which take `unknown` so
// they work at all three race sites (the analysis race also yields an
// AnalyzePullRequestOutput, which has no `kind` field) without a per-race union.

/**
 * True when the sleep branch won (idle timeout or debounce timer expired).
 * `ctx.sleep` resolves `undefined` (typed `void`); the signal branches resolve
 * non-null objects, so `undefined` unambiguously identifies the timer winner.
 * The predicate lists `void` (not just `undefined`) because the race result type
 * includes the `void` from `ctx.sleep` — listing it is what lets the false-branch
 * narrow to the signal-payload union at the call sites.
 */
function isTimerWinner(value: unknown): value is undefined | void {
  return value === undefined;
}

/** True when a pull_request_event signal won the race. */
function isEventWinner(value: unknown): value is PullRequestEventPayload {
  return (
    value !== undefined &&
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'event'
  );
}

/** True when a pull_request_closed signal won the race. */
function isClosedWinner(value: unknown): value is PullRequestClosedPayload {
  return (
    value !== undefined &&
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'closed'
  );
}

// ============================================================================
// SIGNAL DEFINITIONS
// ============================================================================

/**
 * pull_request_event: signals a webhook-driven event on a PR.
 *
 * FIX 1: Payload carries kind:'event' so the race winner is unambiguously
 * discriminated from pull_request_closed and the sleep branch.
 */
const pullRequestEventSignal = signal<PullRequestEventPayload>('pull_request_event');

/**
 * pull_request_closed: signals PR close/merge.
 *
 * FIX 1: Payload carries kind:'closed' so the race winner is unambiguously
 * discriminated from pull_request_event and the sleep branch.
 */
const pullRequestClosedSignal = signal<PullRequestClosedPayload>('pull_request_closed');

// ============================================================================
// WORKFLOW DEFINITION
// ============================================================================

/**
 * Pull request orchestrator.
 *
 * Stable workflow id: `pull-request-orchestrator:{repositoryId}:{prNumber}`
 * Dispatched via signalPullRequestEvent (packages/github/src/pull-requests/state/workflow-signals.ts).
 */
export const pullRequestOrchestratorWorkflow = workflow({ name: 'pull-request-orchestrator' })
  .activities({
    analyzePullRequest: {
      execute: analyzePullRequest,
      // Allow up to 3 minutes for GitHub GraphQL + DB write per analysis.
      timeout: '3m',
      // Retry up to 3 times with exponential back-off; certain classes of
      // errors (NotFound, Validation) are treated as permanent by the activity.
      retry: {
        maximumAttempts: 3,
        initialDelay: '5s',
        backoffCoefficient: 2,
        maximumDelay: '1m',
      },
    },
  })
  .signals({
    pull_request_event: pullRequestEventSignal,
    pull_request_closed: pullRequestClosedSignal,
  })
  .execute(async function* (
    ctx,
    input: PullRequestOrchestratorInput,
  ): AsyncGenerator<unknown, PullRequestOrchestratorOutput, unknown> {
    const { workspaceId, repositoryId, prNumber, installationId, owner, repo } = input;

    // Monotonic generation counter for the stale-write fence (weft#584 / FIX 2).
    // Incremented before each ctx.run('analyzePullRequest', ...) call so the
    // activity can detect a superseded write when a push advances the head SHA.
    let analysisGeneration = 0;

    // Number of successfully completed analyses (FIX 4: incremented AFTER yield*).
    let analysisCount = 0;

    // Capture the close signal when it wins a race; used for the final-analysis
    // branch and the completion reason.
    let closedPayload: PullRequestClosedPayload | undefined;

    ctx.log?.info('pull-request-orchestrator: started', {
      workspaceId,
      repositoryId,
      prNumber,
    });

    // =========================================================================
    // MAIN LOOP
    // =========================================================================
    //
    // Structure:
    //   (A) Wait for first event | closed signal | 7-day idle
    //   (B) Sliding debounce — restart 30s clock on each new event
    //   (C) Run analysis, racing a superseding event or close signal
    // The loop restarts from (A) after each completed analysis cycle.
    // =========================================================================

    mainLoop: while (true) {
      // =======================================================================
      // (A) WAIT FOR FIRST EVENT, CLOSE, OR 7-DAY IDLE (FIX 5)
      //
      // The 7-day sleep exists ONLY in this phase. "Idle" means 7 days with no
      // event since the last settled analysis cycle. This matches depict's
      // per-iteration idle condition. weft#456: race accepts sleep + signal.
      // =======================================================================
      ctx.log?.info('pull-request-orchestrator: waiting for event', {
        repositoryId,
        prNumber,
        analysisCount,
      });

      // FIX 1: each branch resolves a discriminated value — event (kind:'event'),
      // closed (kind:'closed'), or undefined (sleep timer).
      const first = yield* ctx.race([
        ctx.waitForSignal('pull_request_event'),
        ctx.waitForSignal('pull_request_closed'),
        ctx.sleep(IDLE_DURATION), // FIX 5: 7-day idle only in phase (A)
      ] as const);

      if (isTimerWinner(first)) {
        // ── Idle timeout ──────────────────────────────────────────────────
        ctx.log?.info('pull-request-orchestrator: idle timeout, completing', {
          repositoryId,
          prNumber,
          analysisCount,
        });
        return { completed: true, completionReason: 'idle_timeout', analysisCount };
      }

      if (isClosedWinner(first)) {
        // ── PR closed before any event arrived — go straight to final analysis ─
        closedPayload = first;
        ctx.log?.info('pull-request-orchestrator: closed signal received before first event', {
          repositoryId,
          prNumber,
          merged: closedPayload.merged,
        });
        // Break out of the main loop to run the final analysis below.
        break;
      }

      // ── pull_request_event won — enter the debounce→analyze cycle ───────
      // FIX 3: the event is consumed (it won the race). A pending event holds
      // for the debounce→analyze cycle below. A supersede during analysis keeps
      // us inside this cycle (re-enters debounce) — it never returns to (A).
      let pendingEvent: PullRequestEventPayload = first;

      // =======================================================================
      // (B+C) DEBOUNCE THEN ANALYZE — one fused cycle that survives supersede.
      //
      // FIX 3: the debounce (B) and analysis (C) phases share one inner loop so
      // a supersede during analysis loops straight back to debounce with the new
      // event — it does NOT fall back to phase (A) (which would drop the change
      // that triggered the supersede). The cycle only ends by: settling +
      // completing an analysis (→ outer loop back to A for the NEXT event), a
      // close signal (→ break to final analysis), or an analysis error (→ return).
      // =======================================================================
      while (true) {
        // ── (B) SLIDING DEBOUNCE — restart 30s clock on each new event ──────
        //   - pull_request_event  → new event supersedes; restart clock
        //   - pull_request_closed → break to final analysis
        //   - ctx.sleep(30s)      → silence, debounce settled; proceed to (C)
        // weft#456: race accepts sleep + waitForSignal.
        let debounceSettled = false;
        while (!debounceSettled) {
          ctx.log?.info('pull-request-orchestrator: debouncing', {
            repositoryId,
            prNumber,
            eventType: pendingEvent.eventType,
          });

          const debounceResult = yield* ctx.race([
            ctx.waitForSignal('pull_request_event'),
            ctx.waitForSignal('pull_request_closed'),
            ctx.sleep(DEBOUNCE_DURATION),
          ] as const);

          if (isTimerWinner(debounceResult)) {
            // 30s silence — debounce settled; proceed to analysis (C).
            debounceSettled = true;
          } else if (isClosedWinner(debounceResult)) {
            // PR closed during debounce — break to final analysis.
            closedPayload = debounceResult;
            ctx.log?.info('pull-request-orchestrator: closed during debounce', {
              repositoryId,
              prNumber,
              merged: closedPayload.merged,
            });
            break mainLoop;
          } else {
            // New event arrived — update pending and restart the 30s clock.
            pendingEvent = debounceResult;
          }
        }

        // ── (C) RUN ANALYSIS, RACING SUPERSEDE AND CLOSE ────────────────────
        //
        // FIX 2 (weft#584): A losing ctx.run branch is NOT aborted by Weft, so a
        // superseded analysis can still complete and write stale data. We pass an
        // incrementing analysisGeneration counter into the activity; the activity
        // compares the head SHA it fetched against pull_request_state.headSha at
        // write time and skips the write if they diverge (generationFenced=true).
        // This is the load-bearing defence, NOT the race abort.
        //
        // FIX 1: if the analysis run completes first, its result is an
        // AnalyzePullRequestOutput (no kind field → falls through). If a signal
        // wins, it carries a kind discriminant.
        // weft#456: race accepts ctx.run + ctx.waitForSignal.
        const currentGeneration = ++analysisGeneration; // FIX 2
        ctx.log?.info('pull-request-orchestrator: running analysis', {
          repositoryId,
          prNumber,
          analysisGeneration: currentGeneration,
        });

        const analysisRaceResult = yield* ctx.race([
          ctx.run('analyzePullRequest', {
            workspaceId,
            repositoryId,
            prNumber,
            installationId,
            owner,
            repository: repo,
            analysisGeneration: currentGeneration, // FIX 2
          }),
          ctx.waitForSignal('pull_request_event'),
          ctx.waitForSignal('pull_request_closed'),
        ] as const);

        if (isClosedWinner(analysisRaceResult)) {
          // Close signal won the analysis race — break to final analysis.
          closedPayload = analysisRaceResult;
          ctx.log?.info('pull-request-orchestrator: closed during analysis', {
            repositoryId,
            prNumber,
            merged: closedPayload.merged,
          });
          break mainLoop;
        }

        if (isEventWinner(analysisRaceResult)) {
          // FIX 3 — SUPERSEDE: a new pull_request_event won the analysis race.
          // The event is consumed (it won). Re-enter DEBOUNCE with this event by
          // looping back to the top of this fused cycle — NOT to phase (A). This
          // guarantees the superseding change still gets a debounce+analysis pass.
          pendingEvent = analysisRaceResult;
          ctx.log?.info(
            'pull-request-orchestrator: superseded by new event; re-entering debounce',
            {
              repositoryId,
              prNumber,
              eventType: analysisRaceResult.eventType,
            },
          );
          continue; // back to (B) debounce of this same fused cycle
        }

        // ── Analysis run completed normally ───────────────────────────────
        // analysisRaceResult is AnalyzePullRequestOutput (no kind field).
        // FIX 4: increment analysisCount ONLY after a successful yield* return.
        // An exception from ctx.run propagates out of the workflow (the engine's
        // retry policy governs attempts); it never reaches here, so a failed
        // analysis never inflates the count.
        const analysisOutput = analysisRaceResult as AnalyzePullRequestOutput;

        analysisCount++; // FIX 4: increment after success only
        ctx.log?.info('pull-request-orchestrator: analysis complete', {
          repositoryId,
          prNumber,
          analysisCount,
          updated: analysisOutput.updated,
          actionItemCount: analysisOutput.actionItemCount,
          generationFenced: analysisOutput.generationFenced,
        });

        // Analysis cycle settled and completed — return to (A) for the NEXT
        // event with a fresh 7-day idle timer.
        continue mainLoop;
      } // end fused debounce→analyze cycle
    } // end mainLoop

    // =========================================================================
    // (D) FINAL ANALYSIS ON CLOSE
    //
    // PR was closed (merged or not). Run one final generation-fenced analysis
    // to capture the final state of the PR, then return.
    //
    // FIX 2 (weft#584): pass analysisGeneration so the activity's generation
    // fence can still skip a stale write if a prior run is still in flight.
    // FIX 4: only increment analysisCount on a non-error return.
    // =========================================================================
    const finalGeneration = ++analysisGeneration;
    ctx.log?.info('pull-request-orchestrator: running final analysis after close', {
      repositoryId,
      prNumber,
      merged: closedPayload?.merged,
      analysisGeneration: finalGeneration,
    });

    try {
      const finalOutput = yield* ctx.run('analyzePullRequest', {
        workspaceId,
        repositoryId,
        prNumber,
        installationId,
        owner,
        repository: repo,
        analysisGeneration: finalGeneration, // FIX 2
      });

      analysisCount++; // FIX 4: only on success
      ctx.log?.info('pull-request-orchestrator: final analysis complete', {
        repositoryId,
        prNumber,
        analysisCount,
        updated: finalOutput.updated,
        actionItemCount: finalOutput.actionItemCount,
        generationFenced: finalOutput.generationFenced,
      });
    } catch (error) {
      // Final analysis failed — log and complete anyway. The PR is closed so
      // a retry on the next signal is not expected. Do NOT increment analysisCount.
      const errorMessage = error instanceof Error ? error.message : String(error);
      ctx.log?.warn('pull-request-orchestrator: final analysis failed', {
        repositoryId,
        prNumber,
        error: errorMessage,
      });
      return {
        completed: true,
        completionReason: 'error',
        analysisCount,
        error: errorMessage,
      };
    }

    const completionReason = closedPayload?.merged ? 'pr_merged' : 'pr_closed';
    ctx.log?.info('pull-request-orchestrator: completing', {
      repositoryId,
      prNumber,
      completionReason,
      analysisCount,
    });

    return { completed: true, completionReason, analysisCount };
  });
