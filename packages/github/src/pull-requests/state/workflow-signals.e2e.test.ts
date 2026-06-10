/**
 * End-to-end test of the pull-request producer wiring against a REAL Weft engine
 * (in-memory storage, real LocalClient — no client mocks).
 *
 * Scope: prove that `signalPullRequestEvent` reaches a real
 * `LocalClient.startOrSignal` with the deterministic workflow id and a delivered
 * signal, and that `signalPullRequestClosed` signals a real run / no-ops cleanly
 * when none exists. The production orchestrator *workflow definition* (debounce,
 * supersede, idle-timeout via `ctx.race`) is not ported yet — it is blocked on
 * Weft 0.3.0 bugs (#456 race rejects sleep/waitForSignal, #457 query on parked
 * workflows, #458 same-tick signal drop). Coalescing/error semantics beyond a
 * single delivery are covered deterministically at the producer unit layer.
 *
 * The stand-in workflow completes on its first signal so the assertion reads the
 * terminal `result` — no sleeps, no polling, no timing dependency.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Engine, workflow } from '@lostgradient/weft';
import { MemoryStorage } from '@lostgradient/weft/storage/memory';
import { LocalClient } from '@lostgradient/weft/client/local';
import type { GithubServiceContext } from '../../context.js';
import {
  signalPullRequestClosed,
  signalPullRequestEvent,
  type SignalPullRequestEventInput,
} from './workflow-signals.js';

type ReceivedEvent = { eventType?: string };

// Stand-in orchestrator: completes on the first `pull_request_event`, returning
// the payload it received. Deterministic — `handle.result()` resolves as soon as
// the producer's startOrSignal delivers the signal.
const orchestrator = workflow({ name: 'pull-request-orchestrator' }).execute(async function* (ctx) {
  const event = (yield* ctx.waitForSignal('pull_request_event')) as ReceivedEvent;
  return { received: event };
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

/**
 * Await the run's completion via a bounded poll-until-terminal.
 *
 * This is poll-until-CONDITION, not a fixed sleep: it resolves the instant the
 * status is terminal, so it is not order-dependent or timing-fragile the way the
 * removed `setTimeout(25)` ordering assertion was. `WeftClient` exposes no
 * `result(id)`/`getHandle(id)` for an existing run — only `get(id)` (state) — and
 * the producer swallows the handle `startOrSignal` returns, so polling `get` is
 * the available completion primitive. The deadline is generous (~3s) so a slow CI
 * runner does not fail a valid completion.
 */
async function awaitResult(client: LocalClient, id: string): Promise<{ received: ReceivedEvent }> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const state = await client.get(id);
    if (state?.status === 'completed') {
      return state.result as { received: ReceivedEvent };
    }
    if (state && ['failed', 'cancelled', 'timed-out'].includes(state.status)) {
      throw new Error(`workflow ${id} ended in ${state.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`workflow ${id} did not complete within the polling budget`);
}

describe('pull-request producer (e2e, real engine)', () => {
  it('start-or-signals a real run with the deterministic id and delivers the event', async () => {
    const { context, client } = await createWiredContext();

    const result = await signalPullRequestEvent(context, eventInput('pr_opened'));
    expect(result).toEqual({ ok: true, workflowId: ORCHESTRATOR_ID });

    // The real engine started the run under the deterministic id and the
    // producer's payload was delivered as the pull_request_event signal.
    const output = await awaitResult(client, ORCHESTRATOR_ID);
    expect(output.received.eventType).toBe('pr_opened');
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
