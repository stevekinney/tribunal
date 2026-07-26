import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PullRequestReviewCommentEvent } from '@octokit/webhooks-types';
import { handlePullRequestReviewComment } from './pull-request-review-comment.server';
import type { WebhookContext } from './types';

const signalPullRequestEventMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('@tribunal/github/pull-requests/state/workflow-signals', () => ({
  signalPullRequestEvent: signalPullRequestEventMock,
}));

describe('handlePullRequestReviewComment', () => {
  beforeEach(() => {
    signalPullRequestEventMock.mockReset();
  });

  it('accepts human-authored created comments without enqueuing review-engine work', async () => {
    await handlePullRequestReviewComment(createPayload('created'), createContext());

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
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

  it('accepts human-authored edits without enqueuing review-engine work', async () => {
    await handlePullRequestReviewComment(createPayload('edited'), createContext());

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
  });

  it('accepts bot-authored deletions without enqueuing review-engine work', async () => {
    await handlePullRequestReviewComment(
      createPayload('deleted', { botSender: true }),
      createContext(),
    );

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
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
