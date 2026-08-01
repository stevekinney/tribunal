import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleReviewThread } from './review-thread.server';
import type { WebhookContext } from './types';

const signalPullRequestEventMock = vi.hoisted(() => vi.fn());
const guards = vi.hoisted(() => ({
  isPullRequestReviewThreadResolvedEvent: vi.fn(),
  isPullRequestReviewThreadUnresolvedEvent: vi.fn(),
}));

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('@tribunal/github/pull-requests/state/workflow-signals', () => ({
  signalPullRequestEvent: signalPullRequestEventMock,
}));

vi.mock('@tribunal/github/webhooks/validate-github-webhook', () => guards);

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
    signalPullRequestEventMock.mockReset();
    guards.isPullRequestReviewThreadResolvedEvent.mockReset().mockReturnValue(false);
    guards.isPullRequestReviewThreadUnresolvedEvent.mockReset().mockReturnValue(false);
  });

  it('accepts resolved-thread payloads without enqueuing review-engine work', async () => {
    guards.isPullRequestReviewThreadResolvedEvent.mockReturnValue(true);

    await handleReviewThread('resolved', payload() as never, createContext());

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
  });

  it('accepts unresolved-thread payloads without enqueuing review-engine work', async () => {
    guards.isPullRequestReviewThreadUnresolvedEvent.mockReturnValue(true);

    await handleReviewThread('unresolved', payload() as never, createContext());

    expect(signalPullRequestEventMock).not.toHaveBeenCalled();
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
