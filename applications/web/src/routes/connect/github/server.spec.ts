/**
 * GitHub App Installation Initiation Tests
 *
 * Tests the security of the GitHub App installation flow:
 * - Authentication requirements
 * - CSRF state cookie generation and security
 * - Redirect URL construction
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() to ensure mock state is available when mocks are hoisted
const {
  mockDev,
  mockState,
  mockEnv,
  mockUser,
  mockOAuthConnection,
  mockGithubRequest,
  mockUserInstallations,
} = vi.hoisted(() => ({
  mockDev: { value: true },
  mockState: { value: 'mock-nonce-12345' },
  mockEnv: { GITHUB_APP_NAME: 'test-github-app', E2E_TEST_MODE: '0' },
  mockUser: { value: null as { id: number; username: string } | null },
  mockOAuthConnection: { value: { id: 1 } as { id: number } | null },
  mockGithubRequest: vi.fn(),
  mockUserInstallations: { value: [] as Array<{ app_slug: string; html_url: string; id: number }> },
}));

// Mock arctic (used for state generation)
vi.mock('arctic', () => ({
  generateState: () => mockState.value,
}));

// Mock SvelteKit
vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
  error: (status: number, message: string) => {
    throw { status, message, type: 'error' };
  },
}));

// Mock $app/environment
vi.mock('$app/environment', () => ({
  get dev() {
    return mockDev.value;
  },
}));

// Mock $env/dynamic/private
vi.mock('$env/dynamic/private', () => ({
  get env() {
    return mockEnv;
  },
}));

vi.mock('$lib/server/auth/authentication', () => ({
  getOAuthConnection: vi.fn(() => Promise.resolve(mockOAuthConnection.value)),
}));

vi.mock('$lib/server/github/user-oauth', () => ({
  getUserOctokit: vi.fn(() =>
    Promise.resolve({
      ok: true,
      octokit: {
        request: mockGithubRequest,
      },
      scopes: {},
    }),
  ),
}));

// Import after mocks
import { GET } from './+server';

describe('GET /connect/github', () => {
  let mockCookies: Map<string, { value: string; options: Record<string, unknown> }>;
  let mockSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDev.value = true;
    mockState.value = 'mock-nonce-12345';
    mockEnv.GITHUB_APP_NAME = 'test-github-app';
    mockUser.value = { id: 1, username: 'testuser' };
    mockOAuthConnection.value = { id: 1 };
    mockUserInstallations.value = [];
    mockGithubRequest.mockImplementation(async (endpoint: string, options?: { page?: number }) => {
      if (endpoint === 'GET /user/installations') {
        return {
          data: {
            installations: (options?.page ?? 1) === 1 ? mockUserInstallations.value : [],
          },
        };
      }
      throw new Error(`Unexpected GitHub endpoint: ${endpoint}`);
    });
    mockCookies = new Map();
    mockSet = vi.fn((name: string, value: string, options: Record<string, unknown>) => {
      mockCookies.set(name, { value, options });
    });
  });

  const createRequest = () => {
    const url = new URL('http://localhost/connect/github');
    return {
      url,
      cookies: {
        set: mockSet,
        get: vi.fn(),
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
  };

  const getStatePayload = (): { nonce?: string } | null => {
    const cookie = mockCookies.get('github_app_state');
    if (!cookie) return null;
    try {
      return JSON.parse(cookie.value);
    } catch {
      return null;
    }
  };

  describe('Authentication requirements', () => {
    it('redirects unauthenticated users to /login with returnTo', async () => {
      expect.assertions(2);

      mockUser.value = null;
      const request = createRequest();

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { status: number; location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toBe('/login?returnTo=%2Fconnect%2Fgithub');
      }
    });

    it('redirects users without an active GitHub connection to account connection', async () => {
      expect.assertions(2);

      mockOAuthConnection.value = null;
      const request = createRequest();

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { status: number; location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toBe('/connect/github/account?returnTo=/connect/github');
      }
    });

    it('allows authenticated users to start the install flow', async () => {
      expect.assertions(2);

      const request = createRequest();

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { status: number; location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toContain('github.com/apps/');
      }
    });
  });

  describe('CSRF state cookie', () => {
    it('sets github_app_state cookie with a nonce', async () => {
      expect.assertions(1);

      const request = createRequest();

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getStatePayload();
      expect(state?.nonce).toBe('mock-nonce-12345');
    });

    it('sets httpOnly flag on state cookie', async () => {
      expect.assertions(1);

      const request = createRequest();

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const cookie = mockCookies.get('github_app_state');
      expect(cookie?.options.httpOnly).toBe(true);
    });

    it('sets sameSite=lax on state cookie', async () => {
      expect.assertions(1);

      const request = createRequest();

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const cookie = mockCookies.get('github_app_state');
      expect(cookie?.options.sameSite).toBe('lax');
    });

    it('sets 10-minute expiry on state cookie', async () => {
      expect.assertions(1);

      const request = createRequest();

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const cookie = mockCookies.get('github_app_state');
      // 10 minutes = 600 seconds
      expect(cookie?.options.maxAge).toBe(600);
    });

    it('does not set secure flag in development', async () => {
      expect.assertions(1);

      mockDev.value = true;
      const request = createRequest();

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const cookie = mockCookies.get('github_app_state');
      expect(cookie?.options.secure).toBe(false);
    });

    it('sets secure flag in production', async () => {
      expect.assertions(1);

      mockDev.value = false;
      const request = createRequest();

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const cookie = mockCookies.get('github_app_state');
      expect(cookie?.options.secure).toBe(true);
    });
  });

  describe('Redirect behavior', () => {
    it('redirects with 302 status code', async () => {
      expect.assertions(1);

      const request = createRequest();

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { status: number };
        expect(redirectData.status).toBe(302);
      }
    });

    it('redirects to GitHub app installation URL', async () => {
      expect.assertions(1);

      const request = createRequest();

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { location: string };
        expect(redirectData.location).toContain(
          'https://github.com/apps/test-github-app/installations/new',
        );
      }
    });

    it('redirects to the existing installation configuration URL when exactly one install exists', async () => {
      expect.assertions(3);
      mockUserInstallations.value = [
        {
          id: 12345,
          app_slug: 'test-github-app',
          html_url: 'https://github.com/settings/installations/12345',
        },
      ];

      const request = createRequest();

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { location: string; status: number; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toBe('https://github.com/settings/installations/12345');
        expect(mockSet).not.toHaveBeenCalled();
      }
    });

    it('paginates GitHub installations before deciding whether an install already exists', async () => {
      expect.assertions(3);
      mockGithubRequest.mockImplementation(
        async (endpoint: string, options?: { page?: number }) => {
          if (endpoint !== 'GET /user/installations') {
            throw new Error(`Unexpected GitHub endpoint: ${endpoint}`);
          }

          const page = options?.page ?? 1;
          if (page === 1) {
            return {
              data: {
                installations: Array.from({ length: 100 }, (_, index) => ({
                  id: index + 1,
                  app_slug: 'other-app',
                  html_url: `https://github.com/settings/installations/${index + 1}`,
                })),
              },
            };
          }

          return {
            data: {
              installations: [
                {
                  id: 12345,
                  app_slug: 'test-github-app',
                  html_url: 'https://github.com/settings/installations/12345',
                },
              ],
            },
          };
        },
      );

      const request = createRequest();

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toBe('https://github.com/settings/installations/12345');
        expect(mockGithubRequest).toHaveBeenLastCalledWith('GET /user/installations', {
          per_page: 100,
          page: 2,
        });
      }
    });

    it('keeps the GitHub target selector when multiple matching installs exist', async () => {
      expect.assertions(2);
      mockUserInstallations.value = [
        {
          id: 12345,
          app_slug: 'test-github-app',
          html_url: 'https://github.com/settings/installations/12345',
        },
        {
          id: 67890,
          app_slug: 'test-github-app',
          html_url: 'https://github.com/organizations/example/settings/installations/67890',
        },
      ];

      const request = createRequest();

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toContain(
          'https://github.com/apps/test-github-app/installations/new',
        );
      }
    });

    it('starts a fresh install flow when listing installations fails', async () => {
      expect.assertions(3);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockGithubRequest.mockRejectedValue(new Error('GitHub API unavailable'));

      const request = createRequest();

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        // Falls through to a fresh install flow instead of surfacing the error.
        expect(redirectData.location).toContain(
          'https://github.com/apps/test-github-app/installations/new',
        );
      }

      expect(warnSpy).toHaveBeenCalledWith(
        'Could not list GitHub installations before starting install flow',
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });

    it('includes state nonce in redirect URL', async () => {
      expect.assertions(1);

      const request = createRequest();

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { location: string };
        const url = new URL(redirectData.location);
        expect(url.searchParams.get('state')).toBe('mock-nonce-12345');
      }
    });
  });

  describe('Environment configuration', () => {
    it('throws error when GITHUB_APP_NAME is not configured', async () => {
      expect.assertions(1);

      mockEnv.GITHUB_APP_NAME = '';
      const request = createRequest();

      await expect(GET(request)).rejects.toThrow('GITHUB_APP_NAME');
    });

    it('throws error when GITHUB_APP_NAME is undefined', async () => {
      expect.assertions(1);

      // @ts-expect-error Testing undefined case
      mockEnv.GITHUB_APP_NAME = undefined;
      const request = createRequest();

      await expect(GET(request)).rejects.toThrow('GITHUB_APP_NAME');
    });
  });
});
