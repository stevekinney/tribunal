import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PullRequestReviewEvent } from '@octokit/webhooks-types';
import { handlePullRequestReview } from './pull-request-review.server';
import type { WebhookContext } from './types';

const signalPullRequestEventMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('@tribunal/github/pull-requests/state/workflow-signals', () => ({
  signalPullRequestEvent: signalPullRequestEventMock,
}));

describe('handlePullRequestReview', () => {
  beforeEach(() => {
    signalPullRequestEventMock.mockReset();
  });

  it('accepts submitted reviews without enqueuing review-engine work', async () => {
    await handlePullRequestReview(createPayload('submitted'), createContext());

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
  });

  it('accepts dismissed reviews without enqueuing review-engine work', async () => {
    await handlePullRequestReview(createPayload('dismissed'), createContext());

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
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
