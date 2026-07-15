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
 *   ctx.raceKeyed returns the winning branch name with its value, so control
 *   flow does not depend on workflow-specific discriminants in signal payloads.
 *
 * FIX 2 — STALE-WRITE FENCE (weft#584, hardened in 0.5.0):
 *   0.5.0 makes a losing ctx.run branch cooperatively aborted: when a signal wins
 *   the analysis race, the losing analyze activity's ctx.signal (AbortSignal)
 *   fires, and the activity's throwIfAborted() checks bail before the write. That
 *   is the FIRST line of defence now. Two defences combine, neither total:
 *     - the cooperative abort catches most supersedes, but an activity already
 *       past its last abort check (or mid-`octokit` call) can still reach the write;
 *     - the head-SHA generation fence skips the write when GitHub's head advanced,
 *       so it covers supersede-by-NEWER-PUSH — but NOT a same-commit supersede
 *       (a new review comment, a thread resolve, a check completing) that leaves
 *       the head SHA unchanged.
 *   So a same-commit supersede is an acknowledged pre-production gap (a durable
 *   per-PR generation lease would close it; see WEFT_MIGRATION_PLAN.md §7). The
 *   analysisGeneration counter is for log correlation, not the write predicate.
 *
 * FIX 3 — SUPERSEDE CONTROL FLOW:
 *   When a pull_request_event wins the analysis race (supersede), the event IS
 *   consumed (it won). Control re-enters the DEBOUNCE phase directly (pending=r),
 *   not the wait-for-first-event phase. See: "superseding event — re-enter debounce".
 *
 * FIX 4 — analysisCount counts analyses that actually WROTE:
 *   incremented only after the yield* ctx.run returns AND the result is not
 *   generationFenced. A thrown analysis (propagates out of ctx.run) and a fenced
 *   no-op (generationFenced=true, all persistence skipped) both leave the count
 *   unchanged, so it reflects real writes, not attempts.
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
 * weft#584: 0.5.0 cooperatively aborts a losing ctx.run branch (fast path); the
 *   generation fence remains the load-bearing correctness guard (see FIX 2).
 *
 * No finalizer (weft#446): unlike installation-sync, this workflow has no DB
 * status row to strand on cancel/timeout. Its only persistent side-effects are
 * the action items written inside the analyze activity, which are DB-authoritative
 * and self-heal on the next analysis cycle. A finalizer is added the day a
 * sandbox-holding (paid-resource) activity is introduced here.
 */

import { workflow, signal } from '@lostgradient/weft';
import type { Duration } from '@lostgradient/weft';
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

/** Payload carried by the pull_request_event signal. */
type PullRequestEventPayload = {
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

/** Payload carried by the pull_request_closed signal. */
type PullRequestClosedPayload = {
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
// SIGNAL DEFINITIONS
// ============================================================================

/** Signals a webhook-driven event on a pull request. */
const pullRequestEventSignal = signal<PullRequestEventPayload>('pull_request_event');

/** Signals pull request close or merge. */
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
      // Retry up to 3 times with exponential back-off. Permanent failures (by
      // error `name`, from packages/github/src/error-taxonomy.ts) skip retries
      // and fail fast — matching depict's nonRetryableErrorTypes policy.
      retry: {
        maximumAttempts: 3,
        initialDelay: '5s',
        backoffCoefficient: 2,
        maximumDelay: '1m',
        nonRetryableErrors: [
          'NonRetryableError',
          'NotFoundError',
          'ValidationError',
          'PermissionError',
          'ConflictError',
        ],
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

    // Debounce/idle durations default to the production constants but can be
    // overridden per-run via `services` (never checkpointed, host memory only).
    // Production passes no services. Tests inject tiny values so the in-process
    // race-branch timers — which advanceTime cannot drive — fire in milliseconds.
    const services = ctx.services as
      | { debounceDuration?: Duration; idleDuration?: Duration }
      | undefined;
    const debounceDuration: Duration = services?.debounceDuration ?? DEBOUNCE_DURATION;
    const idleDuration: Duration = services?.idleDuration ?? IDLE_DURATION;

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

      const first = yield* ctx.raceKeyed({
        event: ctx.waitForSignal('pull_request_event'),
        closed: ctx.waitForSignal('pull_request_closed'),
        idle: ctx.sleep(idleDuration), // FIX 5: 7-day idle only in phase (A)
      });

      if (first.key === 'idle') {
        // ── Idle timeout ──────────────────────────────────────────────────
        ctx.log?.info('pull-request-orchestrator: idle timeout, completing', {
          repositoryId,
          prNumber,
          analysisCount,
        });
        return { completed: true, completionReason: 'idle_timeout', analysisCount };
      }

      if (first.key === 'closed') {
        // ── PR closed before any event arrived — go straight to final analysis ─
        closedPayload = first.value;
        ctx.log?.info('pull-request-orchestrator: closed signal received before first event', {
          repositoryId,
          prNumber,
          merged: closedPayload.merged,
        });
        break;
      }

      // ── pull_request_event won — enter the debounce→analyze cycle ───────
      // FIX 3: the event is consumed (it won the race). A pending event holds
      // for the debounce→analyze cycle below. A supersede during analysis keeps
      // us inside this cycle (re-enters debounce) — it never returns to (A).
      let pendingEvent: PullRequestEventPayload = first.value;

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
        let debounceSettled = false;
        while (!debounceSettled) {
          ctx.log?.info('pull-request-orchestrator: debouncing', {
            repositoryId,
            prNumber,
            eventType: pendingEvent.eventType,
          });

          const debounceResult = yield* ctx.raceKeyed({
            event: ctx.waitForSignal('pull_request_event'),
            closed: ctx.waitForSignal('pull_request_closed'),
            settled: ctx.sleep(debounceDuration),
          });

          if (debounceResult.key === 'settled') {
            debounceSettled = true;
          } else if (debounceResult.key === 'closed') {
            closedPayload = debounceResult.value;
            ctx.log?.info('pull-request-orchestrator: closed during debounce', {
              repositoryId,
              prNumber,
              merged: closedPayload.merged,
            });
            break mainLoop;
          } else {
            pendingEvent = debounceResult.value;
          }
        }

        // ── (C) RUN ANALYSIS, RACING SUPERSEDE AND CLOSE ────────────────────
        //
        // FIX 2 (weft#584, hardened 0.5.0): when a signal wins this race, the
        // losing analyze activity is now cooperatively aborted (its ctx.signal
        // fires; throwIfAborted bails before the write) — the fast path. But that
        // is best-effort. So the activity also re-fetches GitHub's live head SHA
        // before writing and skips the write if it advanced (generationFenced=true,
        // via the analysisGeneration counter for log correlation). Together: the
        // abort catches most race losses; the head-SHA fence covers supersede-by-
        // NEWER-PUSH. Neither covers a SAME-COMMIT supersede (new comment, thread
        // resolve) — that remains a documented pre-production gap (a durable per-PR
        // generation lease would close it; WEFT_MIGRATION_PLAN.md §7).
        //
        // FIX 1: ctx.raceKeyed preserves branch identity for the activity and
        // both signal branches without inspecting their result values.
        // weft#456: race accepts ctx.run + ctx.waitForSignal.
        const currentGeneration = ++analysisGeneration; // FIX 2
        ctx.log?.info('pull-request-orchestrator: running analysis', {
          repositoryId,
          prNumber,
          analysisGeneration: currentGeneration,
        });

        const analysisRaceResult = yield* ctx.raceKeyed({
          analysis: ctx.run('analyzePullRequest', {
            workspaceId,
            repositoryId,
            prNumber,
            installationId,
            owner,
            repository: repo,
            analysisGeneration: currentGeneration, // FIX 2
          }),
          event: ctx.waitForSignal('pull_request_event'),
          closed: ctx.waitForSignal('pull_request_closed'),
        });

        if (analysisRaceResult.key === 'closed') {
          // Close signal won the analysis race — break to final analysis.
          closedPayload = analysisRaceResult.value;
          ctx.log?.info('pull-request-orchestrator: closed during analysis', {
            repositoryId,
            prNumber,
            merged: closedPayload.merged,
          });
          break mainLoop;
        }

        if (analysisRaceResult.key === 'event') {
          // FIX 3 — SUPERSEDE: a new pull_request_event won the analysis race.
          // The event is consumed (it won). Re-enter DEBOUNCE with this event by
          // looping back to the top of this fused cycle — NOT to phase (A). This
          // guarantees the superseding change still gets a debounce+analysis pass.
          pendingEvent = analysisRaceResult.value;
          ctx.log?.info(
            'pull-request-orchestrator: superseded by new event; re-entering debounce',
            {
              repositoryId,
              prNumber,
              eventType: analysisRaceResult.value.eventType,
            },
          );
          continue; // back to (B) debounce of this same fused cycle
        }

        // ── Analysis run completed normally ───────────────────────────────
        // analysisRaceResult is AnalyzePullRequestOutput (no kind field).
        // FIX 4: analysisCount counts analyses that actually WROTE. It is not
        // incremented when the activity throws (an exception propagates out of
        // ctx.run and never reaches here) NOR when the generation fence tripped
        // (generationFenced=true means the activity skipped all persistence), so
        // a fenced no-op is not reported as a completed analysis.
        const analysisOutput: AnalyzePullRequestOutput = analysisRaceResult.value;

        if (analysisOutput.generationFenced) {
          ctx.log?.info('pull-request-orchestrator: analysis fenced (stale; no write)', {
            repositoryId,
            prNumber,
          });
        } else {
          analysisCount++;
          ctx.log?.info('pull-request-orchestrator: analysis complete', {
            repositoryId,
            prNumber,
            analysisCount,
            updated: analysisOutput.updated,
            actionItemCount: analysisOutput.actionItemCount,
          });
        }

        // Analysis cycle settled — return to (A) for the NEXT event with a fresh
        // 7-day idle timer.
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

      // FIX 4: count only analyses that actually wrote — skip a fenced no-op.
      if (finalOutput.generationFenced) {
        ctx.log?.info('pull-request-orchestrator: final analysis fenced (stale; no write)', {
          repositoryId,
          prNumber,
        });
      } else {
        analysisCount++;
        ctx.log?.info('pull-request-orchestrator: final analysis complete', {
          repositoryId,
          prNumber,
          analysisCount,
          updated: finalOutput.updated,
          actionItemCount: finalOutput.actionItemCount,
        });
      }
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
