/**
 * Behavioral e2e tests for the installation-sync workflow.
 *
 * Drives a TestEngine — a real in-memory Weft engine with virtual time control.
 * TestEngine is a subclass of Engine (not a mock); all workflow and activity
 * execution paths are real. Virtual time lets us advance past the 15 s leading
 * debounce and 1 s drain race without waiting on real timers.
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
import { installationSyncWorkflow } from './installation-sync.js';

// ---------------------------------------------------------------------------
// Engine lifecycle
// ---------------------------------------------------------------------------

let engine: TestEngineInstance | undefined;

afterEach(async () => {
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

// Duration strings for the two timer stages.
// The workflow sets a NEW drain timer after the sync completes, so we need
// two separate advanceTime calls — one to fire the debounce and one to fire
// the drain race timer after the sync activity runs.
const PAST_DEBOUNCE = '15s';
const PAST_DRAIN = '2s';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('installation-sync workflow (e2e, real engine)', () => {
  /**
   * 1. A single start runs the sync activity once and the workflow reaches
   *    a terminal (completed) state after the debounce + drain settle.
   *
   * Virtual time advances past the 15 s leading debounce and 1 s drain race.
   * After advanceTime, the scheduler fires expired timers synchronously, so
   * the workflow should complete within a short real-time polling budget.
   */
  it('runs syncRepositories and completes after the debounce and drain settle', async () => {
    const testEngine = createEngine();

    const handle = await testEngine.start('installation-sync', syncInput(), {
      id: WORKFLOW_ID,
    });

    // Stage 1: advance past the 15 s leading debounce. This fires the debounce
    // timer so the workflow proceeds to run the sync activity.
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();

    // Stage 2: advance past the 1 s drain race timer. The drain timer is set
    // AFTER the sync activity completes, so a second advanceTime call is
    // required to process it.
    await testEngine.advanceTime(PAST_DRAIN);
    await yieldToPortableEventLoop();

    const state = await awaitTerminal(testEngine, handle.id);

    expect(state.status).toBe('completed');
    // The activity must have been called at least once.
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith(expect.objectContaining({ db: dbStub }), 42);
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
    await testEngine.advanceTime(PAST_DRAIN);
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
   * Guards the lost-signal / undefined-discriminator fix: a run with one
   * start and no subsequent signals must terminate when the drain window
   * expires, not spin indefinitely.
   *
   * The isSyncRequestedPayload guard differentiates the sleep-branch winner
   * (undefined) from a genuine sync_requested payload. When the drain timer
   * wins, the workflow must exit — this test asserts that invariant.
   */
  it('terminates after the drain window when no buffered signal is waiting', async () => {
    const testEngine = createEngine();

    // Start exactly one run, send no additional signals.
    const handle = await testEngine.start('installation-sync', syncInput(), {
      id: WORKFLOW_ID,
    });

    // Stage 1: advance past the debounce so the sync runs.
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();
    // Stage 2: advance past the drain race timer. With no buffered signals,
    // the timer branch wins and the workflow exits cleanly.
    await testEngine.advanceTime(PAST_DRAIN);
    await yieldToPortableEventLoop();

    const state = await awaitTerminal(testEngine, handle.id);

    expect(state.status).toBe('completed');
    // Only one sync pass should have run (no signal looping).
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  /**
   * 5. A sync_requested signal arriving during the drain window triggers a
   *    SECOND sync pass before the workflow terminates.
   *
   * This is the coalescing loop — the core value over a one-shot function — and
   * the primary purpose of the drain race. A regression where the drain timer
   * always wins (the lost-signal hazard) would drop the second signal and run
   * the sync only once.
   */
  it('loops for a second sync when a signal arrives during the drain window', async () => {
    const testEngine = createEngine();

    const handle = await testEngine.start('installation-sync', syncInput(), {
      id: WORKFLOW_ID,
    });

    // Stage 1: fire the leading debounce so the first sync runs.
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();

    // Buffer a second sync request BEFORE the drain window elapses. The drain
    // race must observe it (waitForSignal wins over the bounded sleep) and loop.
    await testEngine.signal(WORKFLOW_ID, 'sync_requested', syncInput());
    await yieldToPortableEventLoop();

    // Stage 2: fire the drain timer; the buffered signal sends us back into the
    // loop, which re-runs the leading debounce + a second sync, then drains again.
    await testEngine.advanceTime(PAST_DRAIN);
    await yieldToPortableEventLoop();
    await testEngine.advanceTime(PAST_DEBOUNCE);
    await yieldToPortableEventLoop();
    await testEngine.advanceTime(PAST_DRAIN);
    await yieldToPortableEventLoop();

    const state = await awaitTerminal(testEngine, handle.id);

    expect(state.status).toBe('completed');
    // Two sync passes: the initial one plus the coalesced second request.
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
    let releaseSync: (() => void) | undefined;
    mockRefresh.mockImplementation(
      () =>
        new Promise<{ repositoryCount: number; deactivatedRepositoryCount: number }>((resolve) => {
          releaseSync = () => resolve({ repositoryCount: 0, deactivatedRepositoryCount: 0 });
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
    await testEngine.advanceTime(PAST_DRAIN);
    await yieldToPortableEventLoop();

    const state = await awaitTerminal(testEngine, handle.id);
    expect(state.status).toBe('cancelled');

    // The finalizer wrote a reconciliation update after cancellation: syncStatus
    // 'failed' with an interrupt message.
    const finalizerWrites = dbUpdates.slice(writesBeforeCancel);
    const reconciliation = finalizerWrites.find(
      (write) => (write.set as { syncStatus?: string })?.syncStatus === 'failed',
    );
    expect(reconciliation).toBeDefined();
    expect((reconciliation?.set as { syncError?: string })?.syncError).toContain('interrupted');

    // Release the hung activity so the engine can dispose cleanly in afterEach.
    releaseSync?.();
  });
});
