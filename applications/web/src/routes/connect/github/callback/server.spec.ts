/**
 * GitHub App Installation Callback Tests
 *
 * Tests the security and correctness of the installation callback:
 * - CSRF validation (state nonce matching)
 * - Spoofing prevention (verifying installation access via user OAuth token)
 * - Error handling (user denies access, missing parameters)
 * - User binding (installation bound to the logged-in user)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() to ensure mock state is available when mocks are hoisted
const {
  mockUser,
  mockUserAccessToken,
  mockUserInstallations,
  mockUserInstallationPages,
  mockGithubApp,
  mockOctokitRequestError,
} = vi.hoisted(() => ({
  mockUser: { value: null as { id: number; username: string } | null },
  mockUserAccessToken: { value: 'gho_test_token_123' as string | null },
  mockUserInstallations: {
    value: [{ id: 12345, account: { login: 'test-org' } }] as Array<{
      id: number;
      account: { login: string };
    }>,
  },
  mockUserInstallationPages: {
    value: null as Array<
      Array<{
        id: number;
        account: { login: string };
      }>
    > | null,
  },
  mockGithubApp: {
    value: {
      getInstallationOctokit: vi.fn().mockResolvedValue({
        rest: {
          apps: {
            getInstallation: vi.fn().mockResolvedValue({
              data: {
                id: 12345,
                account: { login: 'test-org', type: 'Organization', id: 99999, avatar_url: null },
                repository_selection: 'all',
              },
            }),
          },
        },
      }),
    },
  },
  mockOctokitRequestError: { value: null as { status: number; message: string } | null },
}));

// Mock SvelteKit
vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
  error: (status: number, message: string) => {
    throw { status, message, type: 'error' };
  },
  isRedirect: (e: unknown) =>
    e !== null &&
    typeof e === 'object' &&
    'type' in e &&
    (e as { type: string }).type === 'redirect',
  isHttpError: (e: unknown) =>
    e !== null && typeof e === 'object' && 'type' in e && (e as { type: string }).type === 'error',
}));

// Mock Octokit
vi.mock('octokit', () => ({
  Octokit: class MockOctokit {
    request(endpoint: string, options?: { page?: number }) {
      if (endpoint === 'GET /user/installations') {
        if (mockOctokitRequestError.value) {
          const err = new Error(mockOctokitRequestError.value.message) as Error & {
            status: number;
          };
          err.status = mockOctokitRequestError.value.status;
          return Promise.reject(err);
        }

        if (mockUserInstallationPages.value) {
          return Promise.resolve({
            data: {
              installations: mockUserInstallationPages.value[(options?.page ?? 1) - 1] ?? [],
            },
          });
        }

        return Promise.resolve({
          data: {
            installations: (options?.page ?? 1) === 1 ? mockUserInstallations.value : [],
          },
        });
      }
      return Promise.reject(new Error(`Unknown endpoint: ${endpoint}`));
    }
  },
}));

// Mock GitHub application server module
vi.mock('$lib/server/github/github-application', () => ({
  getGithubApplication: () => mockGithubApp.value,
}));

// Mock github-context adapter (provides DI context to package functions)
vi.mock('$lib/server/github-context', () => ({
  githubContext: {},
}));

// Mock installation records module (moved to package)
vi.mock('@tribunal/github/installations/records', () => ({
  upsertInstallation: vi.fn().mockResolvedValue(undefined),
}));

// Mock user installation bindings module (moved to package)
vi.mock('@tribunal/github/installations/user-bindings', () => ({
  connectInstallationToUser: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@tribunal/github/repositories/service', () => ({
  refreshInstallationRepositories: vi.fn().mockResolvedValue({
    repositoryCount: 2,
    deactivatedRepositoryCount: 0,
  }),
}));

// Mock authentication module
vi.mock('$lib/server/auth/authentication', () => ({
  refreshGitHubTokenIfNeeded: vi
    .fn()
    .mockImplementation(() => Promise.resolve(mockUserAccessToken.value)),
  deleteOAuthConnection: vi.fn().mockResolvedValue(undefined),
}));

// Mock GitHub errors module (pass-through real implementation from package)
vi.mock('@tribunal/github/errors', async () => {
  return await vi.importActual('@tribunal/github/errors');
});

// Import after mocks
import { GET } from './+server';
import { upsertInstallation } from '@tribunal/github/installations/records';
import { connectInstallationToUser } from '@tribunal/github/installations/user-bindings';
import { refreshInstallationRepositories } from '@tribunal/github/repositories/service';
import { deleteOAuthConnection } from '$lib/server/auth/authentication';

describe('GET /connect/github/callback', () => {
  let mockCookies: Map<string, string>;
  let mockCookieDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.value = { id: 1, username: 'testuser' };
    mockUserAccessToken.value = 'gho_test_token_123';
    mockUserInstallations.value = [{ id: 12345, account: { login: 'test-org' } }];
    mockUserInstallationPages.value = null;
    mockOctokitRequestError.value = null;
    mockGithubApp.value = {
      getInstallationOctokit: vi.fn().mockResolvedValue({
        rest: {
          apps: {
            getInstallation: vi.fn().mockResolvedValue({
              data: {
                id: 12345,
                account: { login: 'test-org', type: 'Organization', id: 99999, avatar_url: null },
                repository_selection: 'all',
              },
            }),
          },
        },
      }),
    };
    vi.mocked(refreshInstallationRepositories).mockResolvedValue({
      repositoryCount: 2,
      deactivatedRepositoryCount: 0,
    });
    mockCookies = new Map();
    mockCookies.set('github_app_state', JSON.stringify({ nonce: 'valid-nonce-123' }));
    mockCookieDelete = vi.fn();
  });

  const createRequest = (
    searchParams: Record<string, string> = {},
    stateCookie?: string | null,
  ) => {
    const url = new URL('http://localhost/connect/github/callback');
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }

    // Set default valid state cookie unless explicitly set
    if (stateCookie !== undefined) {
      if (stateCookie === null) {
        mockCookies.delete('github_app_state');
      } else {
        mockCookies.set('github_app_state', stateCookie);
      }
    }

    return {
      url,
      cookies: {
        get: vi.fn((name: string) => mockCookies.get(name)),
        set: vi.fn(),
        delete: mockCookieDelete,
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

  describe('Authentication requirements', () => {
    it('redirects unauthenticated users to /login with returnTo', async () => {
      expect.assertions(2);

      mockUser.value = null;
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { status: number; location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toBe('/login?returnTo=%2Fconnect%2Fgithub');
      }
    });
  });

  describe('Error handling from GitHub', () => {
    it('handles access_denied error from GitHub', async () => {
      expect.assertions(2);

      const request = createRequest({
        error: 'access_denied',
        error_description: 'User denied access',
      });

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { status: number; location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toContain('error=github_denied');
      }
    });

    it('redirects to repositories on denial', async () => {
      expect.assertions(1);

      const request = createRequest({
        error: 'access_denied',
      });

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { location: string };
        expect(redirectData.location).toContain('/repositories');
      }
    });

    it('deletes state cookie on error', async () => {
      expect.assertions(1);

      const request = createRequest({
        error: 'access_denied',
      });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockCookieDelete).toHaveBeenCalledWith('github_app_state', { path: '/' });
    });
  });

  describe('Parameter validation', () => {
    it('returns 400 when installation_id is missing', async () => {
      expect.assertions(2);

      const request = createRequest({
        state: 'valid-nonce-123',
        // No installation_id
      });

      try {
        await GET(request);
      } catch (e) {
        const errorData = e as { status: number; type: string };
        expect(errorData.type).toBe('error');
        expect(errorData.status).toBe(400);
      }
    });
  });

  describe('Update flow without state', () => {
    it('accepts update callbacks without state after verifying installation access', async () => {
      expect.assertions(3);

      const request = createRequest(
        {
          installation_id: '12345',
          setup_action: 'update',
        },
        null, // No state cookie
      );

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toBe('/repositories?github=connected');
        expect(refreshInstallationRepositories).toHaveBeenCalledWith(expect.anything(), 12345);
      }
    });
  });

  describe('CSRF validation', () => {
    it('returns 400 when state cookie is missing', async () => {
      expect.assertions(2);

      const request = createRequest(
        {
          installation_id: '12345',
          state: 'valid-nonce-123',
        },
        null, // No state cookie
      );

      try {
        await GET(request);
      } catch (e) {
        const errorData = e as { status: number; type: string };
        expect(errorData.type).toBe('error');
        expect(errorData.status).toBe(400);
      }
    });

    it('returns 400 when state URL param is missing', async () => {
      expect.assertions(2);

      const request = createRequest({
        installation_id: '12345',
        // No state param
      });

      try {
        await GET(request);
      } catch (e) {
        const errorData = e as { status: number; type: string };
        expect(errorData.type).toBe('error');
        expect(errorData.status).toBe(400);
      }
    });

    it('returns 400 when state nonce does not match cookie', async () => {
      expect.assertions(2);

      const request = createRequest({
        installation_id: '12345',
        state: 'wrong-nonce-456', // Different from cookie
      });

      try {
        await GET(request);
      } catch (e) {
        const errorData = e as { status: number; message: string; type: string };
        expect(errorData.type).toBe('error');
        expect(errorData.status).toBe(400);
      }
    });

    it('returns 400 when state cookie JSON is malformed', async () => {
      expect.assertions(2);

      const request = createRequest(
        {
          installation_id: '12345',
          state: 'valid-nonce-123',
        },
        'not-valid-json{{{',
      );

      try {
        await GET(request);
      } catch (e) {
        const errorData = e as { status: number; type: string };
        expect(errorData.type).toBe('error');
        expect(errorData.status).toBe(400);
      }
    });
  });

  describe('Authorization verification', () => {
    it('redirects to repositories when user has no GitHub OAuth connection', async () => {
      expect.assertions(2);

      mockUserAccessToken.value = null;
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toBe('/connect/github/account?returnTo=/connect/github');
      }
    });
  });

  describe('Spoofing prevention', () => {
    it('accepts an installation that appears after the first GitHub installations page', async () => {
      expect.assertions(2);

      mockUserInstallationPages.value = [
        Array.from({ length: 100 }, (_, index) => ({
          id: index + 1,
          account: { login: `org-${index + 1}` },
        })),
        [{ id: 12345, account: { login: 'test-org' } }],
      ];
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toContain('/repositories?github=connected');
      }
    });

    it('returns 403 when installation_id is not in user installations', async () => {
      expect.assertions(2);

      // User only has access to installation 99999, not 12345
      mockUserInstallations.value = [{ id: 99999, account: { login: 'other-org' } }];
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch (e) {
        const errorData = e as { status: number; type: string };
        expect(errorData.type).toBe('error');
        expect(errorData.status).toBe(403);
      }
    });

    it('returns 403 when user has empty installations list', async () => {
      expect.assertions(2);

      mockUserInstallations.value = [];
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch (e) {
        const errorData = e as { status: number; type: string };
        expect(errorData.type).toBe('error');
        expect(errorData.status).toBe(403);
      }
    });
  });

  describe('GitHub API error handling', () => {
    it('redirects to repositories on 401 from GET /user/installations', async () => {
      expect.assertions(2);

      mockOctokitRequestError.value = { status: 401, message: 'Bad credentials' };
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toContain('/repositories?error=github_token_revoked');
      }
    });

    it('calls deleteOAuthConnection on 401', async () => {
      expect.assertions(1);

      mockOctokitRequestError.value = { status: 401, message: 'Bad credentials' };
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(deleteOAuthConnection).toHaveBeenCalledWith(1, 'github');
    });

    it('deletes state cookie on 401', async () => {
      expect.assertions(1);

      mockOctokitRequestError.value = { status: 401, message: 'Bad credentials' };
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockCookieDelete).toHaveBeenCalledWith('github_app_state', { path: '/' });
    });

    it('returns generic 403 for non-401 GitHub API errors', async () => {
      expect.assertions(2);

      mockOctokitRequestError.value = { status: 403, message: 'Forbidden' };
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch (e) {
        const errorData = e as { status: number; type: string };
        expect(errorData.type).toBe('error');
        expect(errorData.status).toBe(403);
      }
    });

    it('returns generic 403 for 500 GitHub API errors', async () => {
      expect.assertions(2);

      mockOctokitRequestError.value = { status: 500, message: 'Internal Server Error' };
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch (e) {
        const errorData = e as { status: number; type: string };
        expect(errorData.type).toBe('error');
        expect(errorData.status).toBe(403);
      }
    });
  });

  describe('GitHub Application not configured', () => {
    it('returns 500 when the GitHub Application is not configured', async () => {
      expect.assertions(2);

      mockGithubApp.value = null as unknown as (typeof mockGithubApp)['value'];
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch (e) {
        const errorData = e as { status: number; type: string };
        expect(errorData.type).toBe('error');
        expect(errorData.status).toBe(500);
      }
    });
  });

  describe('Account info extraction', () => {
    it("falls back to the account's name when login is absent", async () => {
      expect.assertions(1);

      mockGithubApp.value.getInstallationOctokit = vi.fn().mockResolvedValue({
        rest: {
          apps: {
            getInstallation: vi.fn().mockResolvedValue({
              data: {
                id: 12345,
                account: { name: 'Bot Account', type: 'Bot', id: 99999, avatar_url: null },
                repository_selection: 'all',
              },
            }),
          },
        },
      });
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(upsertInstallation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ accountLogin: 'Bot Account', accountType: 'Bot' }),
      );
    });
  });

  describe('Unexpected installation errors', () => {
    it('returns 400 when binding the installation throws an unexpected error', async () => {
      expect.assertions(2);

      vi.mocked(upsertInstallation).mockRejectedValueOnce(new Error('unexpected db failure'));
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch (e) {
        const errorData = e as { status: number; type: string };
        expect(errorData.type).toBe('error');
        expect(errorData.status).toBe(400);
      }
    });
  });

  describe('Success flow', () => {
    it('creates installation record bound to the user', async () => {
      expect.assertions(1);

      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(upsertInstallation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          installationId: 12345,
          accountLogin: 'test-org',
          accountType: 'Organization',
          userId: 1,
        }),
      );
    });

    it('binds the installation to the user', async () => {
      expect.assertions(1);

      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(connectInstallationToUser).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 1,
          installationId: 12345,
        }),
      );
    });

    it('deletes state cookie on success', async () => {
      expect.assertions(1);

      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockCookieDelete).toHaveBeenCalledWith('github_app_state', { path: '/' });
    });

    it('refreshes repositories for the installation before redirecting', async () => {
      expect.assertions(1);

      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(refreshInstallationRepositories).toHaveBeenCalledWith(expect.anything(), 12345);
    });

    it('redirects to repositories with success flag', async () => {
      expect.assertions(2);

      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toContain('/repositories?github=connected');
      }
    });

    it('keeps the installation connected when repository refresh fails', async () => {
      expect.assertions(4);

      vi.mocked(refreshInstallationRepositories).mockRejectedValueOnce(
        new Error('Repository refresh failed'),
      );
      const request = createRequest({
        installation_id: '12345',
        state: 'valid-nonce-123',
      });

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { location: string; type: string };
        expect(redirectData.type).toBe('redirect');
        expect(redirectData.location).toBe(
          '/repositories?github=connected&error=github_installation_refresh_failed',
        );
      }

      expect(upsertInstallation).toHaveBeenCalled();
      expect(connectInstallationToUser).toHaveBeenCalled();
    });
  });
});
