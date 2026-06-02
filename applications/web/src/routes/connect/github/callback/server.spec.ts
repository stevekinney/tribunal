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
    request(endpoint: string) {
      if (endpoint === 'GET /user/installations') {
        if (mockOctokitRequestError.value) {
          const err = new Error(mockOctokitRequestError.value.message) as Error & {
            status: number;
          };
          err.status = mockOctokitRequestError.value.status;
          return Promise.reject(err);
        }
        return Promise.resolve({ data: { installations: mockUserInstallations.value } });
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
import { deleteOAuthConnection } from '$lib/server/auth/authentication';

describe('GET /connect/github/callback', () => {
  let mockCookies: Map<string, string>;
  let mockCookieDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.value = { id: 1, username: 'testuser' };
    mockUserAccessToken.value = 'gho_test_token_123';
    mockUserInstallations.value = [{ id: 12345, account: { login: 'test-org' } }];
    mockOctokitRequestError.value = null;
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
        session: mockUser.value ? { id: 'session-1' } : null,
      },
    } as unknown as Parameters<typeof GET>[0];
  };

  describe('Authentication requirements', () => {
    it('redirects unauthenticated users to /login/github', async () => {
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
        expect(redirectData.location).toBe('/login/github');
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
    it('redirects to repositories for update without state cookie', async () => {
      expect.assertions(1);

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
        const redirectData = e as { location: string };
        expect(redirectData.location).toBe('/repositories');
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
        expect(redirectData.location).toContain('/repositories?error=github_link_required');
      }
    });
  });

  describe('Spoofing prevention', () => {
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
  });
});
