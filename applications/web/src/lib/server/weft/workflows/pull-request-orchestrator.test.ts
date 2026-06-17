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

let engine: Engine | undefined;
let client: LocalClient;

beforeEach(async () => {
  analyzeMock.mockClear();
  // Reset to the default stub return for each test.
  analyzeMock.mockResolvedValue({ updated: true, actionItemCount: 1, persisted: true });

  // Register via registerWorkflows (side effect) rather than the create({ workflows })
  // option so the engine keeps the unbranded default type that LocalClient's
  // constructor accepts (weft#585) — mirrors production engine.ts.
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
async function awaitTerminal(id: string, budgetMs = 5_000) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const state = await client.get(id);
    if (state?.status === 'completed' || state?.status === 'failed') {
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
});
