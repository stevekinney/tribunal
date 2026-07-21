import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { GithubAppAuthorizationEvent } from '@octokit/webhooks-types';
import { handleAuthorization } from './authorization-lifecycle.server';
import type { WebhookContext } from './types';

const markGitHubTokensInvalidByProviderUserIdMock = vi.hoisted(() => vi.fn());
const invalidateGitHubAccessCacheMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/github/access', () => ({
  markGitHubTokensInvalidByProviderUserId: markGitHubTokensInvalidByProviderUserIdMock,
  invalidateGitHubAccessCache: invalidateGitHubAccessCacheMock,
}));

describe('handleAuthorization', () => {
  beforeEach(() => {
    markGitHubTokensInvalidByProviderUserIdMock.mockReset();
    invalidateGitHubAccessCacheMock.mockReset().mockResolvedValue(undefined);
  });

  it('invalidates tokens and access cache for every affected user on revoked', async () => {
    markGitHubTokensInvalidByProviderUserIdMock.mockResolvedValue([1, 2]);
    const context = createContext();

    await handleAuthorization(createPayload('revoked'), context);

    expect(markGitHubTokensInvalidByProviderUserIdMock).toHaveBeenCalledWith(999);
    expect(invalidateGitHubAccessCacheMock).toHaveBeenCalledTimes(2);
    expect(invalidateGitHubAccessCacheMock).toHaveBeenCalledWith(1);
    expect(invalidateGitHubAccessCacheMock).toHaveBeenCalledWith(2);
    expect(context.logger.info).toHaveBeenCalledWith(expect.stringContaining('invalidated tokens'));
  });

  it('logs and does not throw when a cache invalidation rejects', async () => {
    markGitHubTokensInvalidByProviderUserIdMock.mockResolvedValue([1]);
    invalidateGitHubAccessCacheMock.mockRejectedValue(new Error('redis down'));
    const context = createContext();

    await handleAuthorization(createPayload('revoked'), context);

    expect(context.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, error: expect.any(Error) }),
      expect.stringContaining('Failed to invalidate access cache'),
    );
  });

  it('no-ops for an unhandled action', async () => {
    const context = createContext();

    await handleAuthorization(createPayload('some-other-action'), context);

    expect(markGitHubTokensInvalidByProviderUserIdMock).not.toHaveBeenCalled();
    expect(context.logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'some-other-action' }),
      expect.stringContaining('Unhandled'),
    );
  });
});

function createPayload(action: string): GithubAppAuthorizationEvent {
  return {
    action,
    sender: { id: 999, login: 'steve' },
  } as unknown as GithubAppAuthorizationEvent;
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
