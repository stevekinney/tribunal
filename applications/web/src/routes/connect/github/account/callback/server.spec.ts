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

import { GET } from './+server';
import { consumeOAuthStateCookie, upsertOAuthConnection } from '$lib/server/auth/authentication';
import { invalidateGitHubAccessCache } from '$lib/server/github/access';

describe('GET /connect/github/account/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
