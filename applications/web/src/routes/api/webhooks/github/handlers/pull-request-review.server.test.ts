import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PullRequestReviewEvent } from '@octokit/webhooks-types';
import { handlePullRequestReview } from './pull-request-review.server';
import type { WebhookContext } from './types';

const signalPullRequestEventMock = vi.hoisted(() => vi.fn());
const hasDurableReviewIntentForDrainMock = vi.hoisted(() => vi.fn());
const kickReviewEngineAfterDurableIntentMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('@tribunal/github/pull-requests/state/workflow-signals', () => ({
  signalPullRequestEvent: signalPullRequestEventMock,
}));

vi.mock('./review-engine-kick.server', () => ({
  hasDurableReviewIntentForDrain: hasDurableReviewIntentForDrainMock,
  kickReviewEngineAfterDurableIntent: kickReviewEngineAfterDurableIntentMock,
}));

const okResult = {
  ok: true,
  workflowId: 'review:pr:42:7',
  enqueued: true,
  enqueueStatus: 'enqueued',
};

describe('handlePullRequestReview', () => {
  beforeEach(() => {
    signalPullRequestEventMock.mockReset().mockResolvedValue(okResult);
    hasDurableReviewIntentForDrainMock.mockReset().mockReturnValue(true);
    kickReviewEngineAfterDurableIntentMock.mockReset().mockResolvedValue(undefined);
  });

  it('signals review_submitted and kicks the review engine on submitted', async () => {
    await handlePullRequestReview(createPayload('submitted'), createContext());

    expect(signalPullRequestEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'review_submitted' }),
    );
    expect(kickReviewEngineAfterDurableIntentMock).toHaveBeenCalledTimes(1);
  });

  it('signals review_dismissed on dismissed', async () => {
    await handlePullRequestReview(createPayload('dismissed'), createContext());

    expect(signalPullRequestEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'review_dismissed' }),
    );
  });

  it('no-ops for an unhandled action', async () => {
    const context = createContext();
    await handlePullRequestReview(createPayload('edited'), context);

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
    expect(context.logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'edited' }),
      expect.stringContaining('Unhandled'),
    );
  });

  it('throws when the signal is not ok', async () => {
    signalPullRequestEventMock.mockResolvedValue({
      ok: false,
      workflowId: 'review:pr:42:7',
      error: 'boom',
    });

    await expect(
      handlePullRequestReview(createPayload('submitted'), createContext()),
    ).rejects.toThrow(/Failed to signal PR review submitted/);
  });

  it('logs and skips the kick when the result is not a durable intent', async () => {
    hasDurableReviewIntentForDrainMock.mockReturnValue(false);
    const context = createContext();

    await handlePullRequestReview(createPayload('submitted'), context);

    expect(kickReviewEngineAfterDurableIntentMock).not.toHaveBeenCalled();
    expect(context.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('did not map to a durable review intent'),
    );
  });
});

function createPayload(action: string): PullRequestReviewEvent {
  return {
    action,
    pull_request: { number: 7 },
    repository: { owner: { login: 'lostgradient' }, name: 'tribunal' },
    sender: { login: 'steve' },
  } as unknown as PullRequestReviewEvent;
}

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
