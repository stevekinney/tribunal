import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchManualReviewSignal } from './manual-review-dispatch.server';
import type { WebhookContext } from './types';

const signalManualReviewMock = vi.hoisted(() => vi.fn());
const kickReviewEngineMock = vi.hoisted(() => vi.fn());

vi.mock('@tribunal/github/pull-requests/state/workflow-signals', () => ({
  signalManualReview: signalManualReviewMock,
}));

vi.mock('$lib/server/review/engine-client', () => ({
  kickReviewEngine: kickReviewEngineMock,
}));

describe('dispatchManualReviewSignal', () => {
  beforeEach(() => {
    signalManualReviewMock.mockReset();
    kickReviewEngineMock.mockReset();
  });

  it('signals a manual review for every associated PR and kicks the engine', async () => {
    signalManualReviewMock.mockResolvedValue({
      ok: true,
      workflowId: 'review:pr:1:1',
      enqueued: true,
      enqueueStatus: 'enqueued',
    });
    kickReviewEngineMock.mockResolvedValue({ status: 'sent', ok: true, responseStatus: 202 });

    await dispatchManualReviewSignal(
      {
        eventLabel: 'check_run.rerequested',
        prNumbers: [7, 8],
        owner: 'lostgradient',
        repo: 'tribunal',
        headSha: 'abc123',
        actorLogin: 'steve',
        checkRunId: 555,
      },
      createContext(),
    );

    expect(signalManualReviewMock).toHaveBeenCalledTimes(2);
    expect(signalManualReviewMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prNumber: 7, headSha: 'abc123', checkRunId: 555 }),
    );
    expect(signalManualReviewMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prNumber: 8, headSha: 'abc123', checkRunId: 555 }),
    );
    expect(kickReviewEngineMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there are no associated PRs', async () => {
    await dispatchManualReviewSignal(
      {
        eventLabel: 'check_suite.rerequested',
        prNumbers: [],
        owner: 'lostgradient',
        repo: 'tribunal',
        headSha: 'abc123',
        actorLogin: undefined,
      },
      createContext(),
    );

    expect(signalManualReviewMock).not.toHaveBeenCalled();
    expect(kickReviewEngineMock).not.toHaveBeenCalled();
  });

  it('throws with the failure reason when a signal fails, so the caller can 500-retry', async () => {
    signalManualReviewMock.mockResolvedValue({
      ok: false,
      workflowId: 'review:pr:1:7',
      enqueued: false,
      error: 'db unavailable',
    });

    await expect(
      dispatchManualReviewSignal(
        {
          eventLabel: 'check_run.rerequested',
          prNumbers: [7],
          owner: 'lostgradient',
          repo: 'tribunal',
          headSha: 'abc123',
          actorLogin: 'steve',
        },
        createContext(),
      ),
    ).rejects.toThrow('Failed to signal check_run.rerequested for 1 PR(s)');
    expect(kickReviewEngineMock).not.toHaveBeenCalled();
  });

  it('does not kick the engine when the intent was a no-op (no watchers)', async () => {
    signalManualReviewMock.mockResolvedValue({
      ok: true,
      workflowId: 'review:pr:1:7',
      enqueued: false,
      enqueueStatus: 'no_watchers',
    });

    await dispatchManualReviewSignal(
      {
        eventLabel: 'check_run.rerequested',
        prNumbers: [7],
        owner: 'lostgradient',
        repo: 'tribunal',
        headSha: 'abc123',
        actorLogin: 'steve',
      },
      createContext(),
    );

    expect(kickReviewEngineMock).not.toHaveBeenCalled();
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
