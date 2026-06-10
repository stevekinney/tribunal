import { describe, expect, it, vi } from 'vitest';
import { WorkflowNotFoundError, WorkflowNotRegisteredError } from '@lostgradient/weft';
import type { WeftClient } from '@lostgradient/weft/client';
import type { GithubServiceContext } from '../../context.js';
import {
  signalPullRequestClosed,
  signalPullRequestEvent,
  type SignalPullRequestClosedInput,
  type SignalPullRequestEventInput,
} from './workflow-signals.js';

/**
 * Build a minimal GithubServiceContext for these tests. Only the Weft client
 * resolver matters here; the other dependencies are never touched. Passing a
 * client wires a resolver that returns it; passing nothing wires a resolver that
 * returns `null` (the "no engine configured" path).
 */
function createContext(weftClient?: Partial<WeftClient>): GithubServiceContext {
  return {
    db: {} as GithubServiceContext['db'],
    cache: {} as GithubServiceContext['cache'],
    getInstallationOctokit: vi.fn(),
    resolveWeftClient: () => Promise.resolve((weftClient as WeftClient | undefined) ?? null),
  };
}

const eventInput: SignalPullRequestEventInput = {
  workspaceId: 1,
  repositoryId: 42,
  prNumber: 7,
  installationId: 100,
  owner: 'acme',
  repo: 'widgets',
  eventType: 'review_submitted',
  actorLogin: 'octocat',
  eventId: 'evt-1',
};

const closedInput: SignalPullRequestClosedInput = {
  repositoryId: 42,
  prNumber: 7,
  merged: true,
  actorLogin: 'octocat',
};

const EXPECTED_ID = 'pull-request-orchestrator:42:7';

describe('signalPullRequestEvent', () => {
  it('start-or-signals the per-PR orchestrator with the deterministic id', async () => {
    const startOrSignal = vi.fn().mockResolvedValue({ id: EXPECTED_ID });
    const context = createContext({ startOrSignal });

    const result = await signalPullRequestEvent(context, eventInput);

    expect(result).toEqual({ ok: true, workflowId: EXPECTED_ID });
    expect(startOrSignal).toHaveBeenCalledTimes(1);
    expect(startOrSignal).toHaveBeenCalledWith(
      'pull-request-orchestrator',
      eventInput,
      // signalId is the delivery GUID (eventId) so retries dedup to one signal.
      { name: 'pull_request_event', payload: eventInput, signalId: 'evt-1' },
      { id: EXPECTED_ID },
    );
  });

  it('mints a fresh signalId when the event carries no delivery id', async () => {
    const startOrSignal = vi.fn().mockResolvedValue({ id: EXPECTED_ID });
    const context = createContext({ startOrSignal });
    const { eventId: _omitted, ...withoutEventId } = eventInput;

    await signalPullRequestEvent(context, withoutEventId);

    const signalArg = startOrSignal.mock.calls[0][2] as { signalId: string };
    expect(signalArg.signalId).toEqual(expect.any(String));
    expect(signalArg.signalId.length).toBeGreaterThan(0);
  });

  it('falls back to log-only success when no engine is configured', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const context = createContext(undefined);

    const result = await signalPullRequestEvent(context, eventInput);

    expect(result).toEqual({ ok: true, workflowId: EXPECTED_ID });
    expect(log).toHaveBeenCalledWith(
      '[pull-request-orchestrator] would signal pull request event (no engine)',
      expect.objectContaining({ workflowId: EXPECTED_ID, eventType: 'review_submitted' }),
    );
    log.mockRestore();
  });

  it('reports failure (does not throw) when dispatch errors', async () => {
    const startOrSignal = vi.fn().mockRejectedValue(new Error('engine down'));
    const context = createContext({ startOrSignal });

    const result = await signalPullRequestEvent(context, eventInput);

    expect(result).toEqual({ ok: false, workflowId: EXPECTED_ID, error: 'engine down' });
  });

  it('treats a not-yet-registered orchestrator as no-op success (storage live, workflow unported)', async () => {
    // This is the invariant: a client configured before workflows are ported
    // must NOT 500 webhooks. WorkflowNotRegisteredError => ok:true, no error.
    const startOrSignal = vi
      .fn()
      .mockRejectedValue(new WorkflowNotRegisteredError('pull-request-orchestrator'));
    const context = createContext({ startOrSignal });

    const result = await signalPullRequestEvent(context, eventInput);

    expect(result).toEqual({ ok: true, workflowId: EXPECTED_ID });
  });
});

describe('signalPullRequestClosed', () => {
  it('signals the running orchestrator with the close payload', async () => {
    const signal = vi.fn().mockResolvedValue(undefined);
    const context = createContext({ signal });

    const result = await signalPullRequestClosed(context, closedInput);

    expect(result).toEqual({ ok: true, workflowId: EXPECTED_ID });
    expect(signal).toHaveBeenCalledWith(EXPECTED_ID, 'pull_request_closed', {
      merged: true,
      actorLogin: 'octocat',
    });
  });

  it('treats a missing orchestrator as success (nothing to notify)', async () => {
    const signal = vi.fn().mockRejectedValue(new WorkflowNotFoundError(EXPECTED_ID));
    const context = createContext({ signal });

    const result = await signalPullRequestClosed(context, closedInput);

    expect(result).toEqual({ ok: true, workflowId: EXPECTED_ID });
  });

  it('reports failure for non-not-found errors', async () => {
    const signal = vi.fn().mockRejectedValue(new Error('network blip'));
    const context = createContext({ signal });

    const result = await signalPullRequestClosed(context, closedInput);

    expect(result).toEqual({ ok: false, workflowId: EXPECTED_ID, error: 'network blip' });
  });

  it('falls back to log-only success when no engine is configured', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const context = createContext(undefined);

    const result = await signalPullRequestClosed(context, closedInput);

    expect(result).toEqual({ ok: true, workflowId: EXPECTED_ID });
    expect(log).toHaveBeenCalledWith(
      '[pull-request-orchestrator] would signal pull request closed (no engine)',
      expect.objectContaining({ workflowId: EXPECTED_ID, merged: true }),
    );
    log.mockRestore();
  });
});
