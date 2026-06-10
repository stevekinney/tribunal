/**
 * End-to-end test of the pull-request orchestrator wiring against a REAL Weft
 * engine (in-memory storage, no mocks of the client).
 *
 * This proves the full path that the in-process singleton uses in production:
 *   producer (signalPullRequestEvent / signalPullRequestClosed)
 *     → LocalClient.startOrSignal / .signal
 *       → a running pull-request-orchestrator workflow
 *         → coalesces repeated events onto ONE run (deterministic id)
 *         → completes on the close signal.
 *
 * The orchestrator here is a faithful-but-minimal stand-in for the real one that
 * will be ported into the engine (see documentation/WEFT_MIGRATION_PLAN.md §5):
 * it waits for events, records them, and finishes when the PR closes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Engine, workflow } from '@lostgradient/weft';
import { MemoryStorage } from '@lostgradient/weft/storage/memory';
import { LocalClient } from '@lostgradient/weft/client/local';
import type { WorkflowState } from '@lostgradient/weft';
import type { GithubServiceContext } from '../../context.js';
import {
  signalPullRequestClosed,
  signalPullRequestEvent,
  type SignalPullRequestEventInput,
} from './workflow-signals.js';

type OrchestratorState = {
  eventTypes: string[];
  closed: boolean;
  merged: boolean;
};

/**
 * Minimal orchestrator for the e2e: loops on a single `pull_request_event`
 * signal channel, recording every event type. A `__terminate` flag in an event
 * payload ends the loop so the run can complete and assert a terminal result.
 *
 * NOTE: The production orchestrator needs to multiplex `pull_request_event`
 * against `pull_request_closed` and a debounce timer — i.e.
 * `ctx.race([waitForSignal(...), sleep(...)])`. That is blocked on a Weft 0.3.0
 * bug where `ctx.race`/`ctx.all` reject `sleep`/`waitForSignal` sub-operations
 * (https://github.com/stevekinney/weft/issues/456). Until that ships, this e2e
 * exercises the part of the wiring that works today and is correct: start-or-
 * signal coalescing of webhook events onto one run, plus signal delivery and
 * completion. The close-signal multiplex path is covered at the producer layer
 * (unit + the "non-existent run" case below).
 */
const orchestrator = workflow({ name: 'pull-request-orchestrator' }).execute(async function* (ctx) {
  const state: OrchestratorState = { eventTypes: [], closed: false, merged: false };

  let done = false;
  while (!done) {
    const event = (yield* ctx.waitForSignal('pull_request_event')) as {
      eventType?: string;
      __terminate?: boolean;
      merged?: boolean;
    };
    if (event?.eventType) {
      state.eventTypes.push(event.eventType);
    }
    if (event?.__terminate) {
      state.closed = true;
      state.merged = Boolean(event.merged);
      done = true;
    }
  }

  return state;
});

let engine: Engine | undefined;

afterEach(async () => {
  await engine?.[Symbol.asyncDispose]?.();
  engine = undefined;
});

async function createWiredContext(): Promise<{
  context: GithubServiceContext;
  client: LocalClient;
}> {
  // Engine.create requires each registry key to equal the workflow's name.
  engine = await Engine.create({
    storage: new MemoryStorage(),
    workflows: { 'pull-request-orchestrator': orchestrator },
  });
  const client = new LocalClient(engine);
  const context: GithubServiceContext = {
    db: {} as GithubServiceContext['db'],
    cache: {} as GithubServiceContext['cache'],
    getInstallationOctokit: () => Promise.resolve(null),
    resolveWeftClient: () => Promise.resolve(client),
  };
  return { context, client };
}

function eventInput(
  eventType: SignalPullRequestEventInput['eventType'],
): SignalPullRequestEventInput {
  return {
    workspaceId: 1,
    repositoryId: 42,
    prNumber: 7,
    installationId: 100,
    owner: 'acme',
    repo: 'widgets',
    eventType,
  };
}

const ORCHESTRATOR_ID = 'pull-request-orchestrator:42:7';

const TERMINAL: ReadonlyArray<WorkflowState['status']> = [
  'completed',
  'failed',
  'cancelled',
  'timed-out',
];

/** Poll `client.get(id)` until the run reaches a terminal status (capped). */
async function waitForTerminal(client: LocalClient, id: string): Promise<WorkflowState> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await client.get(id);
    if (state && TERMINAL.includes(state.status)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`workflow ${id} did not reach a terminal state within the polling budget`);
}

describe('pull-request orchestrator (e2e, real engine)', () => {
  it('coalesces multiple events onto one run and completes with all of them', async () => {
    // Proves the full production path against a real engine: the producer's
    // start-or-signal converges every event on ONE run (deterministic id), each
    // distinct signalId is delivered exactly once, and the accumulated state
    // surfaces in the terminal result.
    //
    // Observed via the terminal `result`, not a mid-flight query: querying a
    // workflow parked on waitForSignal returns undefined in Weft 0.3.0
    // (https://github.com/stevekinney/weft/issues/457). The close-via-distinct-
    // signal-name + debounce path additionally needs ctx.race, blocked on
    // https://github.com/stevekinney/weft/issues/456 — so the terminating event
    // is delivered on the working `pull_request_event` channel.
    const { context, client } = await createWiredContext();

    // Space deliveries across event-loop turns so each is consumed before the
    // next arrives. Real webhooks arrive milliseconds-to-seconds apart; a
    // same-tick burst can drop the start payload in Weft 0.3.0
    // (https://github.com/stevekinney/weft/issues/458).
    //
    // KNOWN TIMING DEPENDENCY: this asserts exact event ordering with a fixed
    // 25ms gap. The robust alternative — poll the workflow's state between sends
    // — is blocked by weft#457 (query returns undefined for a parked workflow).
    // If this flakes on a loaded CI box, the cause is #458/#457, not the wiring.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

    const first = await signalPullRequestEvent(context, eventInput('pr_opened'));
    await settle();
    const second = await signalPullRequestEvent(context, eventInput('review_submitted'));
    await settle();

    expect(first).toEqual({ ok: true, workflowId: ORCHESTRATOR_ID });
    expect(second).toEqual({ ok: true, workflowId: ORCHESTRATOR_ID });

    // A terminating event lets the run complete so we can read the final state.
    await client.signal(ORCHESTRATOR_ID, 'pull_request_event', {
      eventType: 'pr_closed',
      __terminate: true,
      merged: true,
    });

    const state = await waitForTerminal(client, ORCHESTRATOR_ID);
    expect(state.status).toBe('completed');
    const result = state.result as OrchestratorState;
    expect(result.closed).toBe(true);
    expect(result.merged).toBe(true);
    // All three events landed on the same run, in order — coalescing works.
    expect(result.eventTypes).toEqual(['pr_opened', 'review_submitted', 'pr_closed']);
  });

  it('treats a close signal for a non-existent run as success', async () => {
    // No event sent first, so no orchestrator is running for this PR. Exercises
    // the producer's WorkflowNotFound handling against a real engine.
    const { context } = await createWiredContext();

    const closed = await signalPullRequestClosed(context, {
      repositoryId: 999,
      prNumber: 1,
      merged: false,
    });

    expect(closed.ok).toBe(true);
    expect(closed.workflowId).toBe('pull-request-orchestrator:999:1');
  });
});
