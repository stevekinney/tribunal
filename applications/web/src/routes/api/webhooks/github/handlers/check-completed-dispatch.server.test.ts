import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchCheckCompletedSignals } from './check-completed-dispatch.server';
import type { WebhookContext } from './types';

const signalPullRequestEventMock = vi.hoisted(() => vi.fn());
const kickReviewEngineAfterDurableIntentCountMock = vi.hoisted(() => vi.fn());

vi.mock('@tribunal/github/pull-requests/state/workflow-signals', () => ({
  signalPullRequestEvent: signalPullRequestEventMock,
}));

vi.mock('./review-engine-kick.server', () => ({
  hasDurableReviewIntentForDrain: (result: { enqueued: boolean; enqueueStatus?: string }) =>
    result.enqueued || result.enqueueStatus === 'duplicate',
  kickReviewEngineAfterDurableIntentCount: kickReviewEngineAfterDurableIntentCountMock,
}));

describe('dispatchCheckCompletedSignals', () => {
  beforeEach(() => {
    signalPullRequestEventMock.mockReset().mockResolvedValue({
      ok: true,
      workflowId: 'review:pr:42:7',
      enqueued: true,
      enqueueStatus: 'enqueued',
    });
    kickReviewEngineAfterDurableIntentCountMock.mockReset().mockResolvedValue(undefined);
  });

  it(
    'signals check_completed with no head_sha — this omission is load-bearing: ' +
      'it is the only thing that stops a check-completed re-enqueue from minting a ' +
      'second, spurious Check Run every time an existing check completes ' +
      "(see createCheckRunForEnqueuedIntents's `!input.headSha` guard). This test must " +
      'fail the moment head_sha starts getting forwarded here.',
    async () => {
      await dispatchCheckCompletedSignals(
        {
          eventLabel: 'check_run',
          prNumbers: [7],
          owner: 'lostgradient',
          repo: 'tribunal',
          actorLogin: 'steve',
        },
        createContext(),
      );

      expect(signalPullRequestEventMock).toHaveBeenCalledTimes(1);
      const call = signalPullRequestEventMock.mock.calls[0][1];
      expect(call).toMatchObject({
        eventType: 'check_completed',
        prNumber: 7,
      });
      expect(call.headSha).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(call, 'headSha')).toBe(false);
    },
  );

  it('signals every PR number associated with the completed check', async () => {
    await dispatchCheckCompletedSignals(
      {
        eventLabel: 'check_suite',
        prNumbers: [7, 8],
        owner: 'lostgradient',
        repo: 'tribunal',
        actorLogin: 'steve',
      },
      createContext(),
    );

    expect(signalPullRequestEventMock).toHaveBeenCalledTimes(2);
    expect(signalPullRequestEventMock.mock.calls.map((call) => call[1].prNumber)).toEqual([7, 8]);
  });

  it('does nothing when the event has no associated pull requests', async () => {
    await dispatchCheckCompletedSignals(
      {
        eventLabel: 'check_run',
        prNumbers: [],
        owner: 'lostgradient',
        repo: 'tribunal',
        actorLogin: 'steve',
      },
      createContext(),
    );

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
    expect(kickReviewEngineAfterDurableIntentCountMock).not.toHaveBeenCalled();
  });

  it('throws when signaling a PR fails, so the webhook route returns a 500 for GitHub to retry', async () => {
    signalPullRequestEventMock.mockResolvedValue({
      ok: false,
      workflowId: 'review:pr:42:7',
      enqueued: false,
      error: 'database unavailable',
    });

    await expect(
      dispatchCheckCompletedSignals(
        {
          eventLabel: 'check_run',
          prNumbers: [7],
          owner: 'lostgradient',
          repo: 'tribunal',
          actorLogin: 'steve',
        },
        createContext(),
      ),
    ).rejects.toThrow('database unavailable');
  });

  it('kicks the review engine once durable review intents exist for at least one PR', async () => {
    await dispatchCheckCompletedSignals(
      {
        eventLabel: 'check_run',
        prNumbers: [7],
        owner: 'lostgradient',
        repo: 'tribunal',
        actorLogin: 'steve',
      },
      createContext(),
    );

    expect(kickReviewEngineAfterDurableIntentCountMock).toHaveBeenCalledWith(1, expect.anything());
  });
});

function createContext(): WebhookContext {
  return {
    deliveryId: 'delivery-1',
    installationId: 100,
    repositoryId: 42,
    logger: createLogger(),
    origin: 'https://tribunal.dev',
  };
}

function createLogger(): WebhookContext['logger'] {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createLogger()),
  };
}
