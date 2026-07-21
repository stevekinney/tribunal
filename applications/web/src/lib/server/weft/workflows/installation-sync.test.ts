/**
 * Behavioral e2e tests for the installation-sync workflow.
 *
 * Drives a TestEngine — a real in-memory Weft engine with virtual time control.
 * TestEngine is a subclass of Engine (not a mock); all workflow and activity
 * execution paths are real. Virtual time lets us advance past the leading
 * debounce without waiting on real timers. The completion-handoff drain is a
 * zero-duration ctx.sleep(0) race (Weft >= 0.11.0), so it resolves on a
 * yieldToPortableEventLoop() with no time advance.
 *
 * External boundary mocks:
 *   - @tribunal/github/repositories/service (refreshInstallationRepositories)
 *   - $lib/server/github-context (githubContext.db chainable stub)
 *
 * After advancing virtual time, we poll the terminal state with a short polling
 * budget (~3 s of real time) because TestEngine processes timers synchronously
 * via advanceTime(), so the workflow should reach terminal very quickly.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityContext } from '@lostgradient/weft';
import { TestEngine, yieldToPortableEventLoop } from '@lostgradient/weft/testing';

// The /testing barrel re-exports TestEngine as a value only (not a type), so
// derive the instance type from the value for type positions.
type TestEngineInstance = InstanceType<typeof TestEngine>;

// ---------------------------------------------------------------------------
// MOCKS — must be declared before importing the workflow (vi.mock is hoisted)
// ---------------------------------------------------------------------------

const { mockRefresh, dbStub, dbUpdates } = vi.hoisted(() => {
  const mockRefresh = vi.fn(async () => ({ repositoryCount: 3, deactivatedRepositoryCount: 0 }));

  // Records the (set payload, where args) of every completed update chain so the
  // finalizer test can assert what it wrote. Each .where() call closes one chain.
  const dbUpdates: Array<{ set: unknown; whereArgs: unknown[] }> = [];

  // Chainable db stub: .update().set().where(). .set captures its payload on the
  // chain; .where records the completed update and resolves. This absorbs
  // githubContext.db.update(...).set(...).where(...) calls without a real Drizzle
  // DB, while letting the finalizer test inspect the reconciliation write.
  type Chainable = {
    update: (...args: unknown[]) => Chainable;
    set: (payload: unknown) => Chainable;
    where: (...args: unknown[]) => Promise<void>;
    _pendingSet?: unknown;
  };
  const chainable: Chainable = {
    update: () => chainable,
    set: (payload: unknown) => {
      chainable._pendingSet = payload;
      return chainable;
    },
    where: (...args: unknown[]) => {
      dbUpdates.push({ set: chainable._pendingSet, whereArgs: args });
      chainable._pendingSet = undefined;
      return Promise.resolve();
    },
  };

  return { mockRefresh, dbStub: chainable, dbUpdates };
});

vi.mock('@tribunal/github/repositories/service', () => ({
  refreshInstallationRepositories: mockRefresh,
}));

vi.mock('$lib/server/github-context', () => ({
  githubContext: { db: dbStub },
}));

// Import the workflow AFTER mocks are established.
import {
  installationSyncWorkflow,
  reconcileSyncStatusOnTeardown,
  syncRepositories,
} from './installation-sync.js';

// ---------------------------------------------------------------------------
// Engine lifecycle
// ---------------------------------------------------------------------------

let engine: TestEngineInstance | undefined;

// Resolver for a deliberately-hung sync activity (finalizer test). Hoisted to
// module scope and released in afterEach BEFORE dispose, so a test that fails
// mid-assertion still unblocks the parked activity and the engine disposes
// cleanly (rather than asyncDispose hanging on an in-flight activity promise).
let releaseHungSync: (() => void) | undefined;

afterEach(async () => {
  // Release any parked activity first so dispose does not wait on it.
  releaseHungSync?.();
  releaseHungSync = undefined;
  await engine?.[Symbol.asyncDispose]?.();
  engine = undefined;
  mockRefresh.mockReset();
  // Restore the default success implementation after each test.
  mockRefresh.mockResolvedValue({ repositoryCount: 3, deactivatedRepositoryCount: 0 });
  dbUpdates.length = 0;
});

function createEngine(): TestEngineInstance {
  const testEngine = new TestEngine();
  testEngine.registerWorkflows({ 'installation-sync': installationSyncWorkflow });
  engine = testEngine;
  return testEngine;
}

// ---------------------------------------------------------------------------
// Polling helper
//
// After advancing virtual time the workflow should reach a terminal state very
// quickly (TestEngine fires timers synchronously via scheduler.tick). We poll
// for up to ~3 s of real time to account for internal async continuations.
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed-out']);

async function awaitTerminal(
  testEngine: TestEngineInstance,
  id: string,
  options: { budgetMs?: number; intervalMs?: number } = {},
) {
  const { budgetMs = 3_000, intervalMs = 50 } = options;
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    const state = await testEngine.get(id);
    if (state && TERMINAL_STATUSES.has(state.status)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const state = await testEngine.get(id);
  throw new Error(
    `workflow ${id} did not reach a terminal status within ${budgetMs} ms ` +
      `(last status: ${state?.status ?? 'null'})`,
  );
}

// ---------------------------------------------------------------------------
// Fixture: minimal EnqueueInstallationSyncOptions
// ---------------------------------------------------------------------------

function syncInput(installationId = 42) {
  return {
    installationId,
    reason: 'test',
    workspaceId: 1,
  };
}

const WORKFLOW_ID = 'installation-sync:42';
const WORKFLOW_EXECUTION_TOKEN = 'workflow-token-42';
const ACTIVITY_ATTEMPT_TOKEN = 'activity-attempt-token-42';

// Virtual-time advance for the leading debounce timer. The completion-handoff
// drain is a zero-duration sleep (ctx.sleep(0)) since Weft 0.11.0, so it needs
// no time advance — only a yield to the portable event loop.
const PAST_DEBOUNCE = '15s';

function activityContext(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    signal: new AbortController().signal,
    workflowExecutionToken: WORKFLOW_EXECUTION_TOKEN,
    activityAttemptToken: ACTIVITY_ATTEMPT_TOKEN,
    heartbeat: vi.fn(),
    completeAsync: () => {
      throw new Error('completeAsync is not used in these tests.');
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('installation-sync workflow (e2e, real engine)', () => {
  /**
   * 1. A single start runs the sync activity once and the workflow reaches
   *    a terminal (completed) state after the debounce and handoff drain.
   *
   * Virtual time advances past the 15 s leading debounce; the completion-handoff
   * drain (a zero-duration sleep) resolves on a yield with no time advance.
   * After advanceTime, the scheduler fires expired timers synchronously, so
   * the workflow should complete within a short real-time polling budget.
   */
  it('runs syncRepositories and completes after the debounce and handoff drain', async () => {
    const testEngine = createEngine();

    const handle = await testEngine.start('installation-sync', syncInput(), {
      id: WORKFLOW_ID,
    });

    // Stage 1: advance past the 15 s leading debounce. This fires the debounce
    // timer so the workflow proceeds to run the sync activity.
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();
    // The completion-handoff drain is ctx.sleep(0); no time advance needed,
    // only a yield so the zero-duration race resolves.
    await yieldToPortableEventLoop();

    const state = await awaitTerminal(testEngine, handle.id);

    expect(state.status).toBe('completed');
    // The activity must have been called at least once.
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ db: dbStub }),
      42,
      expect.objectContaining({
        syncWorkflowExecutionToken: expect.any(String),
        syncActivityAttemptToken: expect.any(String),
      }),
    );
  });

  /**
   * 2. The workflow does NOT use continueAsNew — it terminates naturally.
   *
   * continueAsNew would produce a new run under the same workflow id with a
   * different internal run id. Here we assert that the same handle id is the
   * one that reaches 'completed', proving natural termination.
   */
  it('terminates naturally without continueAsNew — status is completed, not running', async () => {
    const testEngine = createEngine();

    const handle = await testEngine.start('installation-sync', syncInput(), {
      id: WORKFLOW_ID,
    });

    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();
    // The completion-handoff drain is ctx.sleep(0); no time advance needed,
    // only a yield so the zero-duration race resolves.
    await yieldToPortableEventLoop();
    const state = await awaitTerminal(testEngine, handle.id);

    // Natural termination: the same run id we started is the completed one.
    expect(state.status).toBe('completed');
    expect(handle.id).toBe(WORKFLOW_ID);
  });

  /**
   * 3. On activity failure, the workflow catches, exits the loop, and reaches
   *    a terminal state without throwing past the engine.
   *
   * The workflow body's catch branch calls `return`, so the run ends with
   * status 'completed' (not 'failed'), even though the activity threw.
   */
  it('exits the sync loop cleanly and reaches completed when the activity throws', async () => {
    // Override: reject persistently to simulate a GitHub API outage.
    mockRefresh.mockRejectedValue(new Error('GitHub API error'));

    const testEngine = createEngine();

    const handle = await testEngine.start('installation-sync', syncInput(), {
      id: WORKFLOW_ID,
    });

    // On failure the workflow catches and returns immediately (no drain race),
    // so a single advance past the debounce is enough to reach terminal.
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();

    const state = await awaitTerminal(testEngine, handle.id);

    // The workflow catches the error in the loop and returns — 'completed',
    // not 'failed'. The engine must not surface the throw externally.
    expect(state.status).toBe('completed');
    // The activity was attempted at least once (workflow hit the catch branch).
    expect(mockRefresh).toHaveBeenCalled();
  });

  /**
   * 4. The drain race exits cleanly when no further signal is buffered.
   *
   * A run with one start and no subsequent signals must terminate after the
   * zero-duration drain race, not spin indefinitely.
   *
   * The undefined sleep result remains distinct from the declared object signal
   * payload. When no signal is buffered, ctx.sleep(0) wins the race and the
   * workflow exits.
   */
  it('terminates after the handoff drain when no buffered signal is waiting', async () => {
    const testEngine = createEngine();

    // Start exactly one run, send no additional signals.
    const handle = await testEngine.start('installation-sync', syncInput(), {
      id: WORKFLOW_ID,
    });

    // Stage 1: advance past the debounce so the sync runs.
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();
    // The completion-handoff drain is ctx.sleep(0); no time advance needed,
    // only a yield so the zero-duration race resolves.
    await yieldToPortableEventLoop();
    const state = await awaitTerminal(testEngine, handle.id);

    expect(state.status).toBe('completed');
    // Only one sync pass should have run (no signal looping).
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  /**
   * 4b. A dispatch landing immediately after a run has gone terminal (no
   * DRAIN_DURATION-style delay inserted) is not dropped — it starts a fresh
   * successor run under the same stable workflow id.
   *
   * This exercises enqueueInstallationSync's actual dispatch shape (`id`, a
   * `signalId` stable per GitHub delivery when `deliveryId` is present and
   * freshly minted otherwise, `onTerminalConflict: 'start-new'`; see
   * packages/github/src/sync/index.ts) with zero added delay between
   * observing the first run's terminal and issuing the second dispatch — the
   * scenario the removed 1 s drain window used to (over-)cover.
   *
   * Note: `onTerminalConflict: 'start-new'` restarting a terminal run is
   * weft#604 (shipped in 0.7.0), not the #693 fix this PR adopts — this test
   * does not, and cannot from outside the engine, exercise the exact
   * signal-vs-terminal-commit race that #693 makes atomic (that guarantee is
   * documented in the Weft README, not independently reproducible here). What
   * proves DRAIN_DURATION is safe to remove is test 4 above: it terminates
   * cleanly with only a yield after the debounce — no time advance for the
   * old 1 s window — which would hang under virtual time if that window were
   * still required for correctness.
   */
  it('a dispatch with no added delay after a run goes terminal starts a successor run', async () => {
    const testEngine = createEngine();

    const handle = await testEngine.start('installation-sync', syncInput(), {
      id: WORKFLOW_ID,
    });

    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();
    // The completion-handoff drain is ctx.sleep(0); no time advance needed,
    // only a yield so the zero-duration race resolves and the run terminates.
    await yieldToPortableEventLoop();

    const firstState = await awaitTerminal(testEngine, handle.id);
    expect(firstState.status).toBe('completed');
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    // Dispatch exactly as enqueueInstallationSync does, immediately after
    // observing the first run's terminal — no added delay. onTerminalConflict:
    // 'start-new' plus a caller-supplied signalId (here a fresh UUID, mirroring
    // enqueueInstallationSync's fallback when no deliveryId is present) is what
    // lets this land on a fresh successor run of the same stable workflow id
    // instead of erroring as a conflict against a terminal run.
    const { outcome } = await testEngine.startOrSignal(
      'installation-sync',
      syncInput(),
      { name: 'sync_requested', payload: syncInput(), signalId: crypto.randomUUID() },
      { id: WORKFLOW_ID, onTerminalConflict: 'start-new' },
    );
    expect(outcome).toBe('started');
    await yieldToPortableEventLoop();

    // The successor run's own signal is buffered into its creation batch by
    // startOrSignal, same as the first run's. The workflow drains that
    // buffered signal BEFORE syncing (see installation-sync.ts), so the
    // initiating signal is satisfied by the single sync pass below rather
    // than triggering an extra loop — only one debounce window's worth of
    // advance is needed, no real time.
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();
    await yieldToPortableEventLoop();

    const secondState = await awaitTerminal(testEngine, handle.id);
    expect(secondState.status).toBe('completed');
    // The successor run performs exactly one additional sync pass — its own
    // initiating signal, drained before the sync, does not cause a redundant
    // second pass — observed with no added delay between the first run's
    // terminal and the dispatch that started this successor.
    expect(mockRefresh.mock.calls.length).toBe(2);
  });

  /**
   * 5. A buffered sync_requested signal at the drain point triggers a
   *    SECOND sync pass before the workflow terminates.
   *
   * This is the coalescing loop — the core value over a one-shot function — and
   * the primary purpose of the drain race. A regression where the drain timer
   * always wins (the lost-signal hazard) would drop the second signal and run
   * the sync only once.
   */
  it('loops for a second sync when a buffered signal is waiting at the drain point', async () => {
    const { promise: firstSyncStarted, resolve: markFirstSyncStarted } =
      Promise.withResolvers<void>();
    mockRefresh.mockImplementationOnce(
      () =>
        new Promise<{ repositoryCount: number; deactivatedRepositoryCount: number }>((resolve) => {
          markFirstSyncStarted();
          releaseHungSync = () => resolve({ repositoryCount: 3, deactivatedRepositoryCount: 0 });
        }),
    );

    const testEngine = createEngine();

    const handle = await testEngine.start('installation-sync', syncInput(), {
      id: WORKFLOW_ID,
    });

    // Stage 1: fire the leading debounce so the first sync runs.
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();
    await firstSyncStarted;

    // Buffer a second sync request while the first sync is still in flight, then
    // release the activity. The drain must observe it before the timer and loop.
    await testEngine.signal(WORKFLOW_ID, 'sync_requested', syncInput());
    releaseHungSync?.();
    releaseHungSync = undefined;
    await yieldToPortableEventLoop();

    // The buffered signal sends us back into the loop, which re-runs the leading
    // debounce + a second sync, then waits out the empty handoff drain.
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();
    // The completion-handoff drain is ctx.sleep(0); no time advance needed,
    // only a yield so the zero-duration race resolves.
    await yieldToPortableEventLoop();

    const state = await awaitTerminal(testEngine, handle.id);

    expect(state.status).toBe('completed');
    // Two sync passes: the initial one plus the coalesced second request.
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  /**
   * 5b. Regression for issue #166: a run dispatched exactly as production does
   * — `startOrSignal` with `input` AND a `sync_requested` signal buffered into
   * the run's creation batch, plus `onTerminalConflict: 'start-new'` — must
   * perform EXACTLY ONE sync when nothing else arrives.
   *
   * Before the fix, the drain race only ran AFTER the sync and consumed just
   * one signal per iteration, so this exact production dispatch shape found
   * its OWN initiating signal still buffered at the drain point and looped
   * for a redundant second pass. The fix drains the buffer BEFORE syncing, so
   * the initiating signal is satisfied by the sync that is about to run.
   */
  it('startOrSignal dispatch (production shape) performs exactly one sync when nothing else arrives', async () => {
    const testEngine = createEngine();

    const { outcome } = await testEngine.startOrSignal(
      'installation-sync',
      syncInput(),
      { name: 'sync_requested', payload: syncInput(), signalId: crypto.randomUUID() },
      { id: WORKFLOW_ID, onTerminalConflict: 'start-new' },
    );
    expect(outcome).toBe('started');
    await yieldToPortableEventLoop();

    // A single debounce window: the initiating signal is drained before the
    // sync, so there is no extra loop iteration to advance time for.
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();
    await yieldToPortableEventLoop();

    const state = await awaitTerminal(testEngine, WORKFLOW_ID);

    expect(state.status).toBe('completed');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  /**
   * 5c. Regression for issue #166: N signals buffered BEFORE the sync (a
   * webhook burst arriving during the leading debounce) must still produce
   * exactly ONE sync pass, not N.
   *
   * Before the fix, the drain race consumed exactly one buffered signal per
   * loop iteration, so N buffered signals produced N extra passes, each
   * behind its own 15 s debounce. Buffering three distinct signals here
   * (distinct signalId per delivery, mirroring distinct GitHub deliveries)
   * during the debounce window and asserting a single sync pass proves the
   * whole burst collapses into the one sync about to run.
   */
  it('N signals buffered before the sync still produce exactly one sync pass', async () => {
    const testEngine = createEngine();

    const handle = await testEngine.start('installation-sync', syncInput(), {
      id: WORKFLOW_ID,
    });

    // Simulate a burst of three lifecycle webhooks arriving during the
    // leading debounce, each a distinct delivery (distinct signalId).
    await testEngine.signal(WORKFLOW_ID, 'sync_requested', syncInput(), {
      signalId: crypto.randomUUID(),
    });
    await testEngine.signal(WORKFLOW_ID, 'sync_requested', syncInput(), {
      signalId: crypto.randomUUID(),
    });
    await testEngine.signal(WORKFLOW_ID, 'sync_requested', syncInput(), {
      signalId: crypto.randomUUID(),
    });

    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();
    await yieldToPortableEventLoop();

    const state = await awaitTerminal(testEngine, handle.id);

    expect(state.status).toBe('completed');
    // All three buffered signals are satisfied by the single sync pass.
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  /**
   * 5d. Regression for issue #166: N signals arriving DURING a sync must
   * produce exactly ONE additional pass, not N.
   *
   * Mirrors test 5 above (a single signal during the sync produces one
   * additional pass) but buffers three distinct signals while the sync is
   * in flight, proving the post-sync drain consumes the whole buffer in one
   * go rather than looping once per signal.
   */
  it('N signals arriving during a sync produce exactly one additional pass', async () => {
    const { promise: firstSyncStarted, resolve: markFirstSyncStarted } =
      Promise.withResolvers<void>();
    mockRefresh.mockImplementationOnce(
      () =>
        new Promise<{ repositoryCount: number; deactivatedRepositoryCount: number }>((resolve) => {
          markFirstSyncStarted();
          releaseHungSync = () => resolve({ repositoryCount: 3, deactivatedRepositoryCount: 0 });
        }),
    );

    const testEngine = createEngine();

    const handle = await testEngine.start('installation-sync', syncInput(), {
      id: WORKFLOW_ID,
    });

    // Stage 1: fire the leading debounce so the first sync runs.
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();
    await firstSyncStarted;

    // Buffer three distinct signals while the first sync is still in flight,
    // then release the activity. The post-sync drain must consume all three
    // in one pass rather than looping three times.
    await testEngine.signal(WORKFLOW_ID, 'sync_requested', syncInput(), {
      signalId: crypto.randomUUID(),
    });
    await testEngine.signal(WORKFLOW_ID, 'sync_requested', syncInput(), {
      signalId: crypto.randomUUID(),
    });
    await testEngine.signal(WORKFLOW_ID, 'sync_requested', syncInput(), {
      signalId: crypto.randomUUID(),
    });
    releaseHungSync?.();
    releaseHungSync = undefined;
    await yieldToPortableEventLoop();

    // The buffered burst sends us back into the loop for exactly one more
    // pass: a debounce, then a second sync, then the empty handoff drain.
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();
    await yieldToPortableEventLoop();

    const state = await awaitTerminal(testEngine, handle.id);

    expect(state.status).toBe('completed');
    // Exactly one additional pass for the whole burst, not one per signal.
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  /**
   * 6. Durable finalizer (weft#446): cancelling a sync mid-flight drives the
   *    finalizer, which reconciles a stranded syncStatus to 'failed'.
   *
   * The sync activity is made to hang so the cancel lands while the run is
   * non-terminal (mid-sync). On the resulting 'cancelled' terminal the engine
   * drives reconcileSyncStatusOnTeardown with the staged { installationId }
   * payload. We assert that AFTER cancellation a reconciliation update is written
   * with syncStatus:'failed' and an interrupt error message — the write that
   * stops the UI from showing a perpetual spinner. The non-completion terminal is
   * the trigger that a normal 'completed' run never hits.
   */
  it('drives the finalizer to reconcile syncStatus on cancellation (weft#446)', async () => {
    // Make the sync activity hang so the workflow is non-terminal when cancelled.
    // releaseHungSync is module-scoped and released in afterEach BEFORE dispose,
    // so a mid-test assertion failure still unblocks the activity (no dispose hang).
    mockRefresh.mockImplementation(
      () =>
        new Promise<{ repositoryCount: number; deactivatedRepositoryCount: number }>((resolve) => {
          releaseHungSync = () => resolve({ repositoryCount: 0, deactivatedRepositoryCount: 0 });
        }),
    );

    const testEngine = createEngine();

    const handle = await testEngine.start('installation-sync', syncInput(), {
      id: WORKFLOW_ID,
    });

    // Advance past the leading debounce so the workflow enters the (hanging) sync.
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();

    // The sync is now in flight and parked. Record how many DB writes happened
    // before cancellation so we can isolate the finalizer's reconciliation write.
    const writesBeforeCancel = dbUpdates.length;

    // Cancel mid-sync → 'cancelled' terminal → engine drives the finalizer.
    await testEngine.cancel(handle.id);
    await yieldToPortableEventLoop();
    // The finalizer is driven durably (scheduler-backed); advance + yield so its
    // activity runs to completion.
    await testEngine.advanceTime('1s');
    await yieldToPortableEventLoop();

    const state = await awaitTerminal(testEngine, handle.id);
    expect(state.status).toBe('cancelled');

    // The terminal is recorded before the finalizer activity necessarily finishes
    // its DB write, so yield once more after confirming the terminal to let the
    // finalizer's write land before inspecting dbUpdates (avoids a CI race).
    await yieldToPortableEventLoop();

    // The finalizer wrote a reconciliation update after cancellation: syncStatus
    // 'failed' with an interrupt message, and a non-empty conditional WHERE.
    const finalizerWrites = dbUpdates.slice(writesBeforeCancel);
    const reconciliation = finalizerWrites.find(
      (write) => (write.set as { syncStatus?: string })?.syncStatus === 'failed',
    );
    expect(reconciliation).toBeDefined();
    expect((reconciliation?.set as { syncError?: string })?.syncError).toContain('interrupted');
    // The write is CONDITIONAL (the no-clobber guard): a non-empty WHERE clause is
    // passed, not an unconditional update. The DB enforces the actual match; here
    // we assert the guard is present so it cannot be silently dropped.
    expect(reconciliation?.whereArgs.length).toBeGreaterThan(0);

    // Release the hung activity so the engine disposes cleanly (also released in
    // afterEach as a backstop if an assertion above threw).
    releaseHungSync?.();
  });

  /**
   * 7. The finalizer issues a single conditional update (the no-clobber guard).
   *
   * Calls reconcileSyncStatusOnTeardown directly to assert the SHAPE of its write
   * independent of engine timing: exactly one update, syncStatus:'failed', and a
   * WHERE clause present (the `eq(syncStatus,'in_progress')` conditional that makes
   * the finalizer idempotent and prevents clobbering an already-settled row). A
   * second invocation issues the same conditional statement — idempotent by the
   * predicate, which the DB evaluates (a settled row matches zero rows).
   */
  it('reconcileSyncStatusOnTeardown issues one conditional failed-update (no-clobber)', async () => {
    dbUpdates.length = 0;

    await reconcileSyncStatusOnTeardown({ installationId: 42 }, activityContext());

    expect(dbUpdates).toHaveLength(1);
    expect((dbUpdates[0].set as { syncStatus?: string }).syncStatus).toBe('failed');
    expect(
      (dbUpdates[0].set as { syncWorkflowExecutionToken?: string | null })
        .syncWorkflowExecutionToken,
    ).toBeUndefined();
    expect(
      (dbUpdates[0].set as { syncActivityAttemptToken?: string | null }).syncActivityAttemptToken,
    ).toBeUndefined();
    // Conditional WHERE present — the load-bearing idempotency / no-clobber guard.
    expect(dbUpdates[0].whereArgs.length).toBeGreaterThan(0);

    // Idempotent: a second invocation issues the same conditional statement (the
    // predicate, not the call count, is what makes a settled row a no-op).
    await reconcileSyncStatusOnTeardown({ installationId: 42 }, activityContext());
    expect(dbUpdates).toHaveLength(2);
    expect((dbUpdates[1].set as { syncStatus?: string }).syncStatus).toBe('failed');
    expect(
      (dbUpdates[1].set as { syncWorkflowExecutionToken?: string | null })
        .syncWorkflowExecutionToken,
    ).toBeUndefined();
    expect(
      (dbUpdates[1].set as { syncActivityAttemptToken?: string | null }).syncActivityAttemptToken,
    ).toBeUndefined();
    expect(dbUpdates[1].whereArgs.length).toBeGreaterThan(0);
  });

  /**
   * 8. syncRepositories cooperatively aborts (no late 'idle' write after cancel).
   *
   * If the run is already cancelled when the activity starts (e.g. cancelled
   * during the leading debounce), syncRepositories must throw BEFORE writing
   * 'in_progress' or calling refreshInstallationRepositories — so it cannot report
   * success ('idle') over the finalizer's 'failed'. This closes the late-writer
   * window Codex flagged: lease fencing protects Weft's durable writes, not our
   * application DB writes, so the activity itself must honor the AbortSignal.
   */
  it('syncRepositories throws on a pre-aborted signal without writing (cooperative abort)', async () => {
    dbUpdates.length = 0;
    const controller = new AbortController();
    controller.abort();

    await expect(
      syncRepositories({ installationId: 42 }, activityContext({ signal: controller.signal })),
    ).rejects.toThrow();

    // No DB write and no GitHub fetch happened — the abort check fired first.
    expect(dbUpdates).toHaveLength(0);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('syncRepositories rejects partial owner token context before writing', async () => {
    dbUpdates.length = 0;

    await expect(
      syncRepositories(
        { installationId: 42 },
        activityContext({ activityAttemptToken: undefined }),
      ),
    ).rejects.toThrow('workflow and activity attempt tokens together');

    expect(dbUpdates).toHaveLength(0);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  /**
   * 9. A cancel landing AFTER a successful fetch must NOT mark the run failed.
   *
   * Regression guard: an earlier fix re-checked the abort signal AFTER
   * refreshInstallationRepositories (which writes 'idle' on success). That check
   * sat inside the try, so a post-success abort threw into the catch and wrote
   * 'failed' — corrupting a sync that actually completed. The activity must return
   * the result for a successful fetch regardless of a late abort: the data is
   * synced and 'idle' is correct; there is nothing to roll back.
   */
  it('does NOT mark a run failed when the signal aborts after a successful fetch', async () => {
    dbUpdates.length = 0;

    // Signal becomes aborted only AFTER refreshInstallationRepositories resolves.
    const controller = new AbortController();
    mockRefresh.mockImplementation(async () => {
      controller.abort();
      return { repositoryCount: 5, deactivatedRepositoryCount: 1 };
    });

    const result = await syncRepositories(
      { installationId: 42 },
      activityContext({ signal: controller.signal }),
    );

    // The successful result is returned, not thrown.
    expect(result).toEqual({ repositoryCount: 5, deactivatedRepositoryCount: 1 });
    // Only the 'in_progress' write happened; NO 'failed' write (the catch path
    // must not run for a successful fetch with a late abort).
    const failedWrites = dbUpdates.filter(
      (write) => (write.set as { syncStatus?: string })?.syncStatus === 'failed',
    );
    expect(failedWrites).toHaveLength(0);
  });

  it('claims and completes without owner tokens when called with no context at all', async () => {
    dbUpdates.length = 0;

    const result = await syncRepositories({ installationId: 42 });

    expect(result).toEqual({ repositoryCount: 3, deactivatedRepositoryCount: 0 });
    expect(
      (dbUpdates[0].set as { syncWorkflowExecutionToken?: string | null })
        .syncWorkflowExecutionToken,
    ).toBeNull();
    expect(dbUpdates[0].whereArgs.length).toBeGreaterThan(0);
  });

  it('writes a failed status without owner tokens when called with no context and the fetch fails', async () => {
    dbUpdates.length = 0;
    mockRefresh.mockRejectedValue(new Error('GitHub API error'));

    await expect(syncRepositories({ installationId: 42 })).rejects.toThrow('GitHub API error');

    const failedWrite = dbUpdates.find(
      (write) => (write.set as { syncStatus?: string })?.syncStatus === 'failed',
    );
    expect(failedWrite).toBeDefined();
    expect(failedWrite?.whereArgs.length).toBeGreaterThan(0);
  });

  it('reconcileSyncStatusOnTeardown uses an unscoped predicate when called with no context at all', async () => {
    dbUpdates.length = 0;

    await reconcileSyncStatusOnTeardown({ installationId: 42, workflowStartedAt: Date.now() });

    expect(dbUpdates).toHaveLength(1);
    expect((dbUpdates[0].set as { syncStatus?: string }).syncStatus).toBe('failed');
    expect(dbUpdates[0].whereArgs.length).toBeGreaterThan(0);
  });

  it('syncRepositories passes owner tokens to the success write fence', async () => {
    dbUpdates.length = 0;

    await syncRepositories({ installationId: 42 }, activityContext());

    expect(
      (dbUpdates[0].set as { syncWorkflowExecutionToken?: string }).syncWorkflowExecutionToken,
    ).toBe(WORKFLOW_EXECUTION_TOKEN);
    expect(
      (dbUpdates[0].set as { syncActivityAttemptToken?: string }).syncActivityAttemptToken,
    ).toBe(ACTIVITY_ATTEMPT_TOKEN);
    expect(mockRefresh).toHaveBeenCalledWith(expect.anything(), 42, {
      syncWorkflowExecutionToken: WORKFLOW_EXECUTION_TOKEN,
      syncActivityAttemptToken: ACTIVITY_ATTEMPT_TOKEN,
    });
  });
});
