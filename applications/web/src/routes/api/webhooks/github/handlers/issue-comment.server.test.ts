import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleIssueComment } from './issue-comment.server';
import type { WebhookContext } from './types';

const signalPullRequestEventMock = vi.hoisted(() => vi.fn());
const hasDurableReviewIntentForDrainMock = vi.hoisted(() => vi.fn());
const kickReviewEngineAfterDurableIntentMock = vi.hoisted(() => vi.fn());
const guards = vi.hoisted(() => ({
  isIssueCommentCreatedEvent: vi.fn(),
  isIssueCommentEditedEvent: vi.fn(),
  isIssueCommentDeletedEvent: vi.fn(),
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

/** A minimal issue_comment-on-PR payload shape, narrowed by the mocked guards. */
function payload(
  options: {
    isPullRequestComment?: boolean;
    issueNumber?: number | null;
    botSender?: boolean;
    body?: string;
  } = {},
) {
  const {
    isPullRequestComment = true,
    issueNumber = 7,
    botSender = false,
    body = 'looks good',
  } = options;
  return {
    issue: { pull_request: isPullRequestComment ? {} : undefined, number: issueNumber },
    repository: { owner: { login: 'lostgradient' }, name: 'tribunal' },
    sender: { login: botSender ? 'some-bot' : 'steve', type: botSender ? 'Bot' : 'User' },
    comment: { body },
  };
}

describe('handleIssueComment', () => {
  beforeEach(() => {
    signalPullRequestEventMock.mockReset().mockResolvedValue(okResult);
    hasDurableReviewIntentForDrainMock.mockReset().mockReturnValue(true);
    kickReviewEngineAfterDurableIntentMock.mockReset().mockResolvedValue(undefined);
    guards.isIssueCommentCreatedEvent.mockReset().mockReturnValue(false);
    guards.isIssueCommentEditedEvent.mockReset().mockReturnValue(false);
    guards.isIssueCommentDeletedEvent.mockReset().mockReturnValue(false);
  });

  it('signals issue_comment_created for a human-authored created comment', async () => {
    guards.isIssueCommentCreatedEvent.mockReturnValue(true);
    const data = payload();

    await handleIssueComment('created', data as never, createContext());

    expect(signalPullRequestEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'issue_comment_created', prNumber: 7 }),
    );
    expect(kickReviewEngineAfterDurableIntentMock).toHaveBeenCalledTimes(1);
  });

  it('signals issue_comment_edited for a matching payload', async () => {
    guards.isIssueCommentEditedEvent.mockReturnValue(true);

    await handleIssueComment('edited', payload() as never, createContext());

    expect(signalPullRequestEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'issue_comment_edited' }),
    );
  });

  it('signals issue_comment_deleted for a matching payload', async () => {
    guards.isIssueCommentDeletedEvent.mockReturnValue(true);

    await handleIssueComment('deleted', payload() as never, createContext());

    expect(signalPullRequestEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'issue_comment_deleted' }),
    );
  });

  it('no-ops when no guard matches the payload', async () => {
    await handleIssueComment('created', payload() as never, createContext());

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
  });

  it('no-ops for a comment on an issue (not a pull request)', async () => {
    guards.isIssueCommentCreatedEvent.mockReturnValue(true);

    await handleIssueComment(
      'created',
      payload({ isPullRequestComment: false }) as never,
      createContext(),
    );

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
  });

  it('no-ops for a bot sender on created (avoids bot feedback loops)', async () => {
    guards.isIssueCommentCreatedEvent.mockReturnValue(true);

    await handleIssueComment('created', payload({ botSender: true }) as never, createContext());

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
  });

  it('throws when the signal is not ok', async () => {
    guards.isIssueCommentCreatedEvent.mockReturnValue(true);
    signalPullRequestEventMock.mockResolvedValue({
      ok: false,
      workflowId: 'review:pr:42:7',
      error: 'boom',
    });

    await expect(
      handleIssueComment('created', payload() as never, createContext()),
    ).rejects.toThrow(/Failed to signal issue_comment created/);
  });

  it('logs and skips the kick when the result is not a durable intent', async () => {
    guards.isIssueCommentCreatedEvent.mockReturnValue(true);
    hasDurableReviewIntentForDrainMock.mockReturnValue(false);
    const context = createContext();

    await handleIssueComment('created', payload() as never, context);

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
