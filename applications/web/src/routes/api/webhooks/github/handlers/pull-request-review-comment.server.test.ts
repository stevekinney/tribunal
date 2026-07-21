import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PullRequestReviewCommentEvent } from '@octokit/webhooks-types';
import { handlePullRequestReviewComment } from './pull-request-review-comment.server';
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

describe('handlePullRequestReviewComment', () => {
  beforeEach(() => {
    signalPullRequestEventMock.mockReset().mockResolvedValue(okResult);
    hasDurableReviewIntentForDrainMock.mockReset().mockReturnValue(true);
    kickReviewEngineAfterDurableIntentMock.mockReset().mockResolvedValue(undefined);
  });

  it('signals review_comment_created for a human-authored created comment', async () => {
    await handlePullRequestReviewComment(createPayload('created'), createContext());

    expect(signalPullRequestEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'review_comment_created' }),
    );
    expect(kickReviewEngineAfterDurableIntentMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a bot-authored created comment', async () => {
    const context = createContext();
    await handlePullRequestReviewComment(createPayload('created', { botSender: true }), context);

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
    expect(context.logger.debug).toHaveBeenCalledWith('Ignoring bot review comment created event');
  });

  it('ignores a bot-authored edited comment', async () => {
    const context = createContext();
    await handlePullRequestReviewComment(createPayload('edited', { botSender: true }), context);

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
    expect(context.logger.debug).toHaveBeenCalledWith('Ignoring bot review comment edited event');
  });

  it('signals review_comment_edited for a human-authored edit', async () => {
    await handlePullRequestReviewComment(createPayload('edited'), createContext());

    expect(signalPullRequestEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'review_comment_edited' }),
    );
  });

  it('allows a bot-authored deletion (deletions keep state current)', async () => {
    await handlePullRequestReviewComment(
      createPayload('deleted', { botSender: true }),
      createContext(),
    );

    expect(signalPullRequestEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'review_comment_deleted' }),
    );
  });

  it('no-ops for an unhandled action', async () => {
    const context = createContext();
    await handlePullRequestReviewComment(createPayload('unknown-action'), context);

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
    expect(context.logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'unknown-action' }),
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
      handlePullRequestReviewComment(createPayload('created'), createContext()),
    ).rejects.toThrow(/Failed to signal PR review comment created/);
  });

  it('logs and skips the kick when the result is not a durable intent', async () => {
    hasDurableReviewIntentForDrainMock.mockReturnValue(false);
    const context = createContext();

    await handlePullRequestReviewComment(createPayload('created'), context);

    expect(kickReviewEngineAfterDurableIntentMock).not.toHaveBeenCalled();
    expect(context.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('did not map to a durable review intent'),
    );
  });
});

function createPayload(
  action: string,
  options: { botSender?: boolean } = {},
): PullRequestReviewCommentEvent {
  return {
    action,
    pull_request: { number: 7 },
    repository: { owner: { login: 'lostgradient' }, name: 'tribunal' },
    sender: {
      login: options.botSender ? 'some-bot' : 'steve',
      type: options.botSender ? 'Bot' : 'User',
    },
  } as unknown as PullRequestReviewCommentEvent;
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
