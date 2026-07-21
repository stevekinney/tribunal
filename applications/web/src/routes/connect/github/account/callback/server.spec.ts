import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUser, mockValidateAuthorizationCode, mockFetch } = vi.hoisted(() => ({
  mockUser: { value: { id: 1, username: 'test-user' } as { id: number; username: string } | null },
  mockValidateAuthorizationCode: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
  error: (status: number, message: string) => {
    throw { status, message, type: 'error' };
  },
}));

vi.mock('$lib/server/auth/authentication', () => ({
  consumeOAuthStateCookie: vi.fn(() => ({
    nonce: 'oauth-state',
    provider: 'github',
    intent: 'connect',
    returnTo: '/connect/github',
    createdAt: Date.now(),
    userId: 1,
  })),
  upsertOAuthConnection: vi.fn().mockResolvedValue(undefined),
  // Faithful stand-in for the real helper: return the token expiry, returning
  // null only for Arctic's known "missing expires_in" case and re-throwing any
  // other failure (so the mock cannot mask an unexpected error).
  readAccessTokenExpiresAt: (tokens: { accessTokenExpiresAt: () => Date }) => {
    try {
      return tokens.accessTokenExpiresAt();
    } catch (error) {
      if (error instanceof Error && error.message === "Missing or invalid 'expires_in' field") {
        return null;
      }
      throw error;
    }
  },
}));

// GitHub App user-to-server tokens expire (~8h); the callback must persist it.
const tokenExpiry = new Date('2026-07-01T00:00:00.000Z');

vi.mock('$lib/server/auth/providers', () => ({
  getProviderClient: () => ({
    validateAuthorizationCode: mockValidateAuthorizationCode,
  }),
}));

vi.mock('$lib/server/github/access', () => ({
  invalidateGitHubAccessCache: vi.fn().mockResolvedValue(undefined),
}));

const mockDbWhere = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDbSet = vi.hoisted(() => vi.fn(() => ({ where: mockDbWhere })));
const mockDbUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockDbSet })));

vi.mock('$lib/server/database', () => ({
  db: { update: mockDbUpdate },
}));

import { GET } from './+server';
import { consumeOAuthStateCookie, upsertOAuthConnection } from '$lib/server/auth/authentication';
import { invalidateGitHubAccessCache } from '$lib/server/github/access';

describe('GET /connect/github/account/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbWhere.mockResolvedValue(undefined);
    mockUser.value = { id: 1, username: 'test-user' };
    mockValidateAuthorizationCode.mockResolvedValue({
      accessToken: () => 'github-access-token',
      hasRefreshToken: () => true,
      refreshToken: () => 'github-refresh-token',
      accessTokenExpiresAt: () => tokenExpiry,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'X-OAuth-Scopes': 'repo,user:email' }),
      json: async () => ({ id: 12345, login: 'octo-user' }),
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  function createRequest(search = '?code=oauth-code&state=oauth-state') {
    return {
      url: new URL(`http://localhost/connect/github/account/callback${search}`),
      cookies: {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        getAll: vi.fn(() => []),
        serialize: vi.fn(),
      },
      locals: {
        get user() {
          return mockUser.value;
        },
        neonSession: mockUser.value
          ? { neonAuthUserId: 'neon-user-1', expiresAt: new Date() }
          : null,
      },
    } as unknown as Parameters<typeof GET>[0];
  }

  it('redirects unauthenticated users to Neon Auth login', async () => {
    mockUser.value = null;

    await expect(GET(createRequest())).rejects.toMatchObject({
      status: 302,
      location: '/login?returnTo=%2Fconnect%2Fgithub',
    });
    expect.assertions(1);
  });

  it('encrypts and stores the app-owned GitHub OAuth connection', async () => {
    await expect(GET(createRequest())).rejects.toMatchObject({
      status: 302,
      location: '/connect/github',
    });

    expect(consumeOAuthStateCookie).toHaveBeenCalledWith(expect.anything(), 'oauth-state', 1);
    expect(upsertOAuthConnection).toHaveBeenCalledWith(1, 'github', {
      providerUserId: '12345',
      accessToken: 'github-access-token',
      refreshToken: 'github-refresh-token',
      expiresAt: tokenExpiry,
      scope: 'repo,user:email',
    });
    expect(invalidateGitHubAccessCache).toHaveBeenCalledWith(1);
    expect.assertions(4);
  });

  it('redirects with github_denied when GitHub reports an OAuth error', async () => {
    await expect(GET(createRequest('?error=access_denied'))).rejects.toMatchObject({
      status: 302,
      location: '/repositories?error=github_denied',
    });
    expect(mockValidateAuthorizationCode).not.toHaveBeenCalled();
  });

  it('errors with 400 when the code or state query parameters are missing', async () => {
    await expect(GET(createRequest('?code=oauth-code'))).rejects.toMatchObject({ status: 400 });
    await expect(GET(createRequest('?state=oauth-state'))).rejects.toMatchObject({ status: 400 });
  });

  it('errors with 400 when the OAuth state cookie is invalid or expired', async () => {
    vi.mocked(consumeOAuthStateCookie).mockReturnValueOnce(null);

    await expect(GET(createRequest())).rejects.toMatchObject({ status: 400 });
  });

  it('redirects with github_failed when exchanging the authorization code fails', async () => {
    mockValidateAuthorizationCode.mockRejectedValue(new Error('bad code'));

    await expect(GET(createRequest())).rejects.toMatchObject({
      status: 302,
      location: '/repositories?error=github_failed',
    });
  });

  it('errors with 400 when the GitHub user lookup fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, headers: new Headers(), json: async () => ({}) });

    await expect(GET(createRequest())).rejects.toMatchObject({ status: 400 });
  });

  it('defaults the scopes when GitHub omits the X-OAuth-Scopes header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ id: 12345, login: 'octo-user' }),
    });

    await expect(GET(createRequest())).rejects.toMatchObject({ status: 302 });

    expect(upsertOAuthConnection).toHaveBeenCalledWith(
      1,
      'github',
      expect.objectContaining({ scope: 'repo,user:email' }),
    );
  });

  it('updates the user avatar when GitHub reports one', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'X-OAuth-Scopes': 'repo' }),
      json: async () => ({ id: 12345, login: 'octo-user', avatar_url: 'https://gh/avatar.png' }),
    });

    await expect(GET(createRequest())).rejects.toMatchObject({ status: 302 });

    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    expect(mockDbSet).toHaveBeenCalledWith({ avatarUrl: 'https://gh/avatar.png' });
  });

  it('does not touch the avatar when GitHub reports none', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'X-OAuth-Scopes': 'repo' }),
      json: async () => ({ id: 12345, login: 'octo-user' }),
    });

    await expect(GET(createRequest())).rejects.toMatchObject({ status: 302 });

    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('logs but does not fail the request when cache invalidation throws', async () => {
    vi.mocked(invalidateGitHubAccessCache).mockRejectedValueOnce(new Error('cache down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(GET(createRequest())).rejects.toMatchObject({ status: 302 });

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to invalidate GitHub access cache:',
      expect.any(Error),
    );
  });
});
