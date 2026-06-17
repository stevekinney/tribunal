/**
 * Behavioral tests for the pull-request-orchestrator workflow.
 *
 * Strategy: run the REAL workflow definition against a REAL in-process Weft
 * engine (MemoryStorage + LocalClient). The analyzePullRequest activity is
 * stubbed via vi.mock so no Octokit / DB access occurs.
 *
 * Each test maps to a specific fix described in the workflow source:
 *   FIX 1 — kind discriminant drives close/event branching
 *   FIX 2 — analysisGeneration is threaded into every activity call
 *   FIX 3 — supersede re-enters debounce, not phase (A)
 *   FIX 4 — analysisCount incremented only after successful yield*
 *   FIX 5 — 7-day idle timer only appears in phase (A)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────────
// Mock the activity BEFORE importing the workflow so the workflow builder
// receives the stub reference. vi.mock is hoisted by Vitest to the top of the
// module, so this call runs before any import in the real execution order.
// ──────────────────────────────────────────────────────────────────────────────
vi.mock('../action-items/analyze-pull-request', () => ({
  analyzePullRequest: vi.fn(async () => ({
    updated: true,
    actionItemCount: 1,
    persisted: true,
  })),
}));

import { Engine } from '@lostgradient/weft';
import { MemoryStorage } from '@lostgradient/weft/storage/memory';
import { LocalClient } from '@lostgradient/weft/client/local';
import { analyzePullRequest } from '../action-items/analyze-pull-request.js';
import { pullRequestOrchestratorWorkflow } from './pull-request-orchestrator.js';
import type { PullRequestOrchestratorOutput } from './pull-request-orchestrator.js';

// ──────────────────────────────────────────────────────────────────────────────
// Typed alias for the mocked activity.
// Test files may play fast and loose with types (per testing rules).
// ──────────────────────────────────────────────────────────────────────────────
const analyzeMock = analyzePullRequest as ReturnType<typeof vi.fn>;

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const BASE_INPUT = {
  workspaceId: 1,
  repositoryId: 42,
  prNumber: 7,
  installationId: 100,
  owner: 'acme',
  repo: 'widgets',
} as const;

const WORKFLOW_ID = 'pull-request-orchestrator:42:7';

/** Minimal pull_request_event payload with required discriminant. */
function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'event' as const,
    workspaceId: BASE_INPUT.workspaceId,
    repositoryId: BASE_INPUT.repositoryId,
    prNumber: BASE_INPUT.prNumber,
    installationId: BASE_INPUT.installationId,
    owner: BASE_INPUT.owner,
    repo: BASE_INPUT.repo,
    eventType: 'review_submitted' as const,
    ...overrides,
  };
}

/** pull_request_closed payload with required discriminant. */
function makeClose(merged: boolean, actorLogin?: string) {
  return { kind: 'closed' as const, merged, actorLogin };
}

// ──────────────────────────────────────────────────────────────────────────────
// Engine lifecycle
// ──────────────────────────────────────────────────────────────────────────────

// The orchestrator's debounce/idle sleeps live INSIDE ctx.race, so they are
// transient in-process timers — TestEngine.advanceTime (which ticks the durable
// scheduler) cannot fire them. Instead we inject tiny debounce/idle durations
// via per-run `services` (defaults to 30s/7d in production) so the real
// in-process timers fire in milliseconds, keeping tests fast and deterministic
// without waiting on wall-clock time.
let engine: Engine | undefined;
let client: LocalClient;

// Tiny per-run timing overrides delivered through `services`.
const TEST_SERVICES = { debounceDuration: '20ms', idleDuration: '40ms' } as const;

beforeEach(async () => {
  analyzeMock.mockClear();
  // Reset to the default stub return for each test.
  analyzeMock.mockResolvedValue({ updated: true, actionItemCount: 1, persisted: true });

  const createdEngine = await Engine.create({ storage: new MemoryStorage() });
  createdEngine.registerWorkflows({ 'pull-request-orchestrator': pullRequestOrchestratorWorkflow });
  engine = createdEngine;
  client = new LocalClient(createdEngine);
});

afterEach(async () => {
  await engine?.[Symbol.asyncDispose]?.();
  engine = undefined;
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Poll until the workflow reaches a terminal status or the budget is exhausted.
 * Returns the final WorkflowState or throws if the budget runs out.
 */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed-out']);

async function awaitTerminal(id: string, budgetMs = 5_000) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const state = await client.get(id);
    // Return on ANY terminal status (not just completed/failed) so a cancelled
    // or timed-out run surfaces immediately instead of looping to the deadline
    // and masking the real status behind a generic timeout error.
    if (state && TERMINAL_STATUSES.has(state.status)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const state = await client.get(id);
  throw new Error(
    `Workflow ${id} did not reach a terminal state within ${budgetMs}ms (status=${state?.status ?? 'unknown'})`,
  );
}

/**
 * Start the orchestrator and immediately signal a pull_request_event,
 * returning the handle for later assertions.
 *
 * startOrSignal requires either a signalId or idempotencyKey. We provide a
 * unique signalId per call to match production semantics (production code uses
 * crypto.randomUUID() when no GitHub delivery GUID is present).
 */
async function startOrSignalEvent(payload = makeEvent()) {
  const handle = await client.startOrSignal(
    'pull-request-orchestrator',
    BASE_INPUT,
    {
      name: 'pull_request_event',
      payload,
      signalId: crypto.randomUUID(),
    },
    { id: WORKFLOW_ID },
  );
  return handle;
}

/**
 * Start the orchestrator with tiny injected debounce/idle durations (services)
 * so the in-process race-branch timers fire in milliseconds, then deliver the
 * first event. `services` is an inline-only `engine.start` option (it cannot ride
 * `client.startOrSignal`), so this dispatches through the engine directly.
 */
async function startWithFastTimers(payload = makeEvent()) {
  await engine!.start('pull-request-orchestrator', BASE_INPUT, {
    id: WORKFLOW_ID,
    services: TEST_SERVICES,
  });
  await client.signal(WORKFLOW_ID, 'pull_request_event', payload);
}

/** Real-time wait helper (the race-branch sleeps are in-process timers). */
function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until the analyze stub has been called at least `n` times, or throw. */
async function waitForCalls(n: number, budgetMs: number) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (analyzeMock.mock.calls.length >= n) return;
    await wait(10);
  }
  throw new Error(
    `analyzePullRequest was called ${analyzeMock.mock.calls.length} times, expected >= ${n} within ${budgetMs}ms`,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('pull-request-orchestrator (behavioral, real engine)', () => {
  /**
   * FIX 1 + close-terminates-loop.
   *
   * A pull_request_closed signal (kind:'closed') sent to a running orchestrator
   * must drive it to a terminal result with completionReason 'pr_closed' or
   * 'pr_merged'. This test would fail if the kind discriminant were missing or
   * broken — the close branch would never win the race and the workflow would
   * park indefinitely.
   */
  it('terminates with pr_closed reason when a closed signal (merged:false) is received', async () => {
    // Start the workflow and deliver an initial event so it's running.
    await startOrSignalEvent();

    // Allow the workflow to park in debounce (it's waiting on the 30s clock).
    // A brief yield lets the engine process the start + signal.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Now signal a close. The workflow is parked in debounce, so this signal
    // wins the next race iteration and drives it to the final-analysis path.
    await client.signal(WORKFLOW_ID, 'pull_request_closed', makeClose(false));

    // The workflow runs a final analysis then returns with completionReason.
    const finalState = await awaitTerminal(WORKFLOW_ID);
    expect(finalState.status).toBe('completed');

    const output = finalState.result as PullRequestOrchestratorOutput;
    expect(output.completed).toBe(true);
    // The discriminant fix (FIX 1) must have routed this as 'pr_closed'.
    expect(output.completionReason).toBe('pr_closed');
    // FIX 4: exactly one successful analysis (the final-on-close run); the count
    // is incremented only after the analysis yield* returns.
    expect(output.analysisCount).toBe(1);
  });

  /**
   * FIX 1 — debounce parks, not instant analysis.
   *
   * A pull_request_event (kind:'event') must NOT drive the workflow to completion
   * immediately — the workflow should park in the debounce phase (waiting for the
   * 30s timer or a superseding event). Asserting that the run is still 'running'
   * shortly after start proves the debounce is in effect rather than the workflow
   * completing synchronously or immediately after the first event.
   */
  it('remains non-terminal (debouncing) after receiving a pull_request_event', async () => {
    // Start via startOrSignal, which delivers the first event.
    await startOrSignalEvent();

    // A short delay ensures the engine has processed the start and signal
    // before we read the state. The debounce timer is 30s — nothing has settled.
    await new Promise((resolve) => setTimeout(resolve, 80));

    const state = await client.get(WORKFLOW_ID);
    // The run must still be alive (running or parked, not terminal).
    expect(state?.status).not.toBe('completed');
    expect(state?.status).not.toBe('failed');
    expect(state?.status).not.toBeNull();
    // analysisCount should be 0 — no analysis has completed yet.
    // (The run is still in debounce phase, so the stub should not have been called.)
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  /**
   * FIX 1 — merged:true close produces 'pr_merged'; merged:false → 'pr_closed'.
   *
   * The completionReason is derived from closedPayload.merged. This tests both
   * discriminant branches to ensure neither is hardcoded.
   */
  it('terminates with pr_merged reason when a closed signal (merged:true) is received', async () => {
    await startOrSignalEvent();
    await new Promise((resolve) => setTimeout(resolve, 50));

    await client.signal(WORKFLOW_ID, 'pull_request_closed', makeClose(true));

    const finalState = await awaitTerminal(WORKFLOW_ID);
    expect(finalState.status).toBe('completed');

    const output = finalState.result as PullRequestOrchestratorOutput;
    expect(output.completed).toBe(true);
    expect(output.completionReason).toBe('pr_merged');
    expect(output.analysisCount).toBe(1); // FIX 4
  });

  /**
   * FIX 2 — analysisGeneration is threaded into the activity.
   *
   * The workflow must pass an analysisGeneration field that is a positive
   * integer (> 0) to the analyzePullRequest activity. This test drives the
   * workflow through one full analysis cycle (start → event → close → final
   * analysis) and inspects all captured call arguments.
   *
   * Without FIX 2 the generation would be 0 or missing, breaking the
   * generation fence inside the activity.
   */
  it('passes a positive analysisGeneration to analyzePullRequest on close', async () => {
    await startOrSignalEvent();
    await new Promise((resolve) => setTimeout(resolve, 50));

    await client.signal(WORKFLOW_ID, 'pull_request_closed', makeClose(false));

    await awaitTerminal(WORKFLOW_ID);

    // At least one call to the activity must have been made (the final analysis
    // triggered by the closed signal).
    expect(analyzeMock).toHaveBeenCalled();

    // Every call must carry a positive analysisGeneration (FIX 2).
    for (const call of analyzeMock.mock.calls) {
      const input = call[0] as { analysisGeneration?: number };
      expect(typeof input.analysisGeneration).toBe('number');
      expect(input.analysisGeneration).toBeGreaterThan(0);
    }
  });

  /**
   * FIX 1 + coalescing — multiple rapid events stay coalesced.
   *
   * Sending several pull_request_event signals in rapid succession should NOT
   * each immediately trigger an analysis. The debounce absorbs them; the
   * analyze stub's call count must remain 0 while the run is still parked.
   *
   * This test would fail if the debounce loop were absent and each signal
   * triggered an immediate analysis.
   */
  it('does not trigger immediate analysis when multiple events arrive in a burst', async () => {
    // Start with the first event.
    await startOrSignalEvent();

    // Deliver several more events in rapid succession (simulating a burst).
    for (let i = 0; i < 4; i++) {
      await client.signal(
        WORKFLOW_ID,
        'pull_request_event',
        makeEvent({ eventType: 'review_comment_created' }),
      );
    }

    // After the burst, allow the engine to process all signals.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const state = await client.get(WORKFLOW_ID);

    // The run must still be alive — the 30s debounce has not settled.
    expect(state?.status).not.toBe('completed');
    expect(state?.status).not.toBe('failed');

    // The analyze stub must NOT have been called — the debounce hasn't expired.
    // A low call count (0) proves coalescing is working.
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  /**
   * FIX 3 — a supersede during the analysis race re-enters DEBOUNCE, not phase
   * (A), so the superseding change is not silently dropped.
   *
   * To force the supersede we make the FIRST analysis hang (a deferred promise),
   * so the analysis is genuinely in-flight in phase (C). We then deliver a new
   * pull_request_event, which wins the analysis race. If FIX 3 regressed (the
   * supersede returned to phase A / dropped the event), a subsequent close would
   * still terminate, but the run would NOT have re-entered the debounce→analyze
   * cycle for the superseding event. We assert the observable signature of a
   * correct re-entry: after releasing the hung analysis and sending a close, the
   * workflow terminates cleanly with a final analysis (analysisCount >= 1) — it
   * never gets stuck and never times out.
   */
  it('re-enters debounce (does not drop the cycle) when an event supersedes an in-flight analysis', async () => {
    // Make the FIRST analysis hang so it is genuinely in flight in phase (C)
    // when the superseding event arrives. Later calls resolve normally.
    let releaseFirstAnalysis: (() => void) | undefined;
    const firstAnalysisHang = new Promise<void>((resolve) => {
      releaseFirstAnalysis = resolve;
    });
    analyzeMock.mockImplementationOnce(async () => {
      await firstAnalysisHang;
      return { updated: true, actionItemCount: 1, persisted: true };
    });

    // Start with tiny (20ms) debounce so the in-process race-sleep fires fast and
    // the workflow leaves phase (B) into phase (C) — the first analysis (hanging)
    // is now genuinely in flight.
    await startWithFastTimers();
    await waitForCalls(1, 1_000); // poll until the first analysis is reached (phase C)
    expect(analyzeMock).toHaveBeenCalledTimes(1);

    // Deliver a superseding event while the analysis is in flight. It wins the
    // phase-(C) race; FIX 3 must re-enter DEBOUNCE (not return to phase A).
    await client.signal(
      WORKFLOW_ID,
      'pull_request_event',
      makeEvent({ eventType: 'check_completed' }),
    );
    // Release the now-superseded (losing) first analysis — its result is dropped.
    releaseFirstAnalysis?.();

    // The re-entered debounce (20ms) settles and a SECOND analysis runs for the
    // superseding event — proof the cycle was NOT dropped back to phase (A).
    await waitForCalls(2, 1_000);
    expect(analyzeMock).toHaveBeenCalledTimes(2);

    // Close to flush to terminal and confirm a clean completion.
    await client.signal(WORKFLOW_ID, 'pull_request_closed', makeClose(false));
    const finalState = await awaitTerminal(WORKFLOW_ID);
    expect(finalState.status).toBe('completed');
    const output = finalState.result as PullRequestOrchestratorOutput;
    expect(output.completionReason).toBe('pr_closed');
  });

  /**
   * The final-analysis catch path returns completionReason 'error' (FIX 4: a
   * failed final analysis does not increment analysisCount).
   */
  it('completes with completionReason error when the final analysis throws', async () => {
    // Throw a NON-retryable error (by name) so the activity fails fast instead of
    // burning the 3× 5s+ retry backoff — keeps the test quick and deterministic.
    const nonRetryable = new Error('analysis boom');
    nonRetryable.name = 'ValidationError';
    analyzeMock.mockRejectedValue(nonRetryable);

    // No first event needed — a close on a fresh run goes straight to final
    // analysis. Start with fast timers and close immediately.
    await engine!.start('pull-request-orchestrator', BASE_INPUT, {
      id: WORKFLOW_ID,
      services: TEST_SERVICES,
    });
    await client.signal(WORKFLOW_ID, 'pull_request_closed', makeClose(false));

    const finalState = await awaitTerminal(WORKFLOW_ID);
    expect(finalState.status).toBe('completed');
    const output = finalState.result as PullRequestOrchestratorOutput;
    expect(output.completionReason).toBe('error');
    // FIX 4: a failed final analysis must not inflate the count.
    expect(output.analysisCount).toBe(0);
    expect(output.error).toContain('analysis boom');
  });

  /**
   * FIX 4 — a generation-FENCED analysis (returned successfully but skipped all
   * writes) must NOT increment analysisCount. It is a no-op, not a completed
   * analysis, so observability/output should not report it as one.
   */
  it('does not count a generation-fenced analysis', async () => {
    // The (final) analysis returns generationFenced=true: success, but no write.
    analyzeMock.mockResolvedValue({
      updated: false,
      actionItemCount: 0,
      persisted: false,
      generationFenced: true,
    });

    await engine!.start('pull-request-orchestrator', BASE_INPUT, {
      id: WORKFLOW_ID,
      services: TEST_SERVICES,
    });
    await client.signal(WORKFLOW_ID, 'pull_request_closed', makeClose(true));

    const finalState = await awaitTerminal(WORKFLOW_ID);
    expect(finalState.status).toBe('completed');
    const output = finalState.result as PullRequestOrchestratorOutput;
    // The run completed (pr_merged), the activity WAS invoked, but the fenced
    // no-op did not inflate the count.
    expect(output.completionReason).toBe('pr_merged');
    expect(analyzeMock).toHaveBeenCalled();
    expect(output.analysisCount).toBe(0);
  });
});
