import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleReviewThread } from './review-thread.server';
import type { WebhookContext } from './types';

const signalPullRequestEventMock = vi.hoisted(() => vi.fn());
const hasDurableReviewIntentForDrainMock = vi.hoisted(() => vi.fn());
const kickReviewEngineAfterDurableIntentMock = vi.hoisted(() => vi.fn());
const guards = vi.hoisted(() => ({
  isPullRequestReviewThreadResolvedEvent: vi.fn(),
  isPullRequestReviewThreadUnresolvedEvent: vi.fn(),
}));

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('@tribunal/github/pull-requests/state/workflow-signals', () => ({
  signalPullRequestEvent: signalPullRequestEventMock,
}));

vi.mock('./review-engine-kick.server', () => ({
  hasDurableReviewIntentForDrain: hasDurableReviewIntentForDrainMock,
  kickReviewEngineAfterDurableIntent: kickReviewEngineAfterDurableIntentMock,
}));

vi.mock('@tribunal/github/webhooks/validate-github-webhook', () => guards);

const okResult = {
  ok: true,
  workflowId: 'review:pr:42:7',
  enqueued: true,
  enqueueStatus: 'enqueued',
};

function payload(options: { prNumber?: number | null } = {}) {
  const { prNumber = 7 } = options;
  return {
    pull_request: { number: prNumber },
    repository: { owner: { login: 'lostgradient' }, name: 'tribunal' },
    sender: { login: 'steve' },
  };
}

describe('handleReviewThread', () => {
  beforeEach(() => {
    signalPullRequestEventMock.mockReset().mockResolvedValue(okResult);
    hasDurableReviewIntentForDrainMock.mockReset().mockReturnValue(true);
    kickReviewEngineAfterDurableIntentMock.mockReset().mockResolvedValue(undefined);
    guards.isPullRequestReviewThreadResolvedEvent.mockReset().mockReturnValue(false);
    guards.isPullRequestReviewThreadUnresolvedEvent.mockReset().mockReturnValue(false);
  });

  it('signals review_thread_resolved for a resolved-thread payload', async () => {
    guards.isPullRequestReviewThreadResolvedEvent.mockReturnValue(true);

    await handleReviewThread('resolved', payload() as never, createContext());

    expect(signalPullRequestEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'review_thread_resolved', prNumber: 7 }),
    );
    expect(kickReviewEngineAfterDurableIntentMock).toHaveBeenCalledTimes(1);
  });

  it('signals review_thread_unresolved for an unresolved-thread payload', async () => {
    guards.isPullRequestReviewThreadUnresolvedEvent.mockReturnValue(true);

    await handleReviewThread('unresolved', payload() as never, createContext());

    expect(signalPullRequestEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'review_thread_unresolved' }),
    );
  });

  it('no-ops when neither guard matches', async () => {
    await handleReviewThread('resolved', payload() as never, createContext());

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
  });

  it('no-ops when the pull request has no number', async () => {
    guards.isPullRequestReviewThreadResolvedEvent.mockReturnValue(true);

    await handleReviewThread('resolved', payload({ prNumber: null }) as never, createContext());

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
  });

  it('throws when the signal is not ok', async () => {
    guards.isPullRequestReviewThreadResolvedEvent.mockReturnValue(true);
    signalPullRequestEventMock.mockResolvedValue({
      ok: false,
      workflowId: 'review:pr:42:7',
      error: 'boom',
    });

    await expect(
      handleReviewThread('resolved', payload() as never, createContext()),
    ).rejects.toThrow(/Failed to signal review_thread resolved/);
  });

  it('logs and skips the kick when the result is not a durable intent', async () => {
    guards.isPullRequestReviewThreadResolvedEvent.mockReturnValue(true);
    hasDurableReviewIntentForDrainMock.mockReturnValue(false);
    const context = createContext();

    await handleReviewThread('resolved', payload() as never, context);

    expect(kickReviewEngineAfterDurableIntentMock).not.toHaveBeenCalled();
    expect(context.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('did not map to a durable review intent'),
    );
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
