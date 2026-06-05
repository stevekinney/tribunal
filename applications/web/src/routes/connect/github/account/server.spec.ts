import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnv, mockUser, mockCreateAuthorizationUrl } = vi.hoisted(() => ({
  mockEnv: {
    GITHUB_CLIENT_ID: 'github-client-id',
    GITHUB_CLIENT_SECRET: 'github-client-secret',
    E2E_TEST_MODE: '0',
  },
  mockUser: { value: { id: 1, username: 'test-user' } as { id: number; username: string } | null },
  mockCreateAuthorizationUrl: vi.fn(
    (state: string, scopes: string[]) =>
      new URL(`https://github.com/login/oauth/authorize?state=${state}&scope=${scopes.join(',')}`),
  ),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$env/dynamic/private', () => ({
  get env() {
    return mockEnv;
  },
}));

vi.mock('$lib/server/auth/authentication', () => ({
  createOAuthState: () => 'oauth-state',
  sanitizeReturnTo: (value: string | null) => value ?? '/',
  setOAuthStateCookie: vi.fn(),
}));

vi.mock('$lib/server/auth/providers', () => ({
  getProviderClient: () => ({
    createAuthorizationURL: mockCreateAuthorizationUrl,
  }),
}));

import { GET } from './+server';
import { setOAuthStateCookie } from '$lib/server/auth/authentication';

describe('GET /connect/github/account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.value = { id: 1, username: 'test-user' };
    mockEnv.GITHUB_CLIENT_ID = 'github-client-id';
    mockEnv.GITHUB_CLIENT_SECRET = 'github-client-secret';
  });

  function createRequest(search = '?returnTo=/connect/github') {
    return {
      url: new URL(`http://localhost/connect/github/account${search}`),
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
      location: '/login?returnTo=%2Fconnect%2Fgithub%2Faccount%3FreturnTo%3D%2Fconnect%2Fgithub',
    });
    expect.assertions(1);
  });

  it('starts GitHub OAuth for repository access with repo and user email scopes', async () => {
    await expect(GET(createRequest())).rejects.toMatchObject({
      status: 302,
      location: expect.stringContaining('https://github.com/login/oauth/authorize'),
    });

    expect(setOAuthStateCookie).toHaveBeenCalledWith(
      expect.anything(),
      'oauth-state',
      'github',
      '/connect/github',
      1,
    );
    expect(mockCreateAuthorizationUrl).toHaveBeenCalledWith('oauth-state', ['repo', 'user:email']);
    expect.assertions(3);
  });
});
