/**
 * GitHub OAuth Login Callback Tests
 *
 * Tests the login/signup OAuth flow:
 * - Unverified/missing email acceptance (no email_required redirect)
 * - Auto-handle creation from GitHub login
 * - Handle unavailable redirect when handle is taken/invalid
 * - Handle unavailable redirect on unique constraint race condition
 * - Email auto-linking with verified email
 * - Email conflict for unverified email matching existing user
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() for mock state so it's available when mocks are hoisted
const {
  mockExistingAuthAccount,
  mockExistingUserByEmail,
  mockHandleValidation,
  mockDbInsertResult,
  mockDbInsertError,
  mockLocals,
} = vi.hoisted(() => ({
  mockExistingAuthAccount: { value: null as { id: number; userId: number } | null },
  mockExistingUserByEmail: { value: null as { id: number; username: string } | null },
  mockHandleValidation: { value: { valid: true } as { valid: boolean; error?: string } },
  mockDbInsertResult: {
    value: { id: 42, username: 'testuser' } as { id: number; username: string },
  },
  mockDbInsertError: { value: null as Error | null },
  mockLocals: { value: { user: null, session: null } as Record<string, unknown> },
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

// Mock auth/authentication (includes merged auth-account functions)
vi.mock('$lib/server/auth/authentication', () => ({
  consumeOAuthStateCookie: vi.fn().mockReturnValue({
    nonce: 'test-nonce',
    provider: 'github',
    intent: 'login',
    returnTo: '/',
    createdAt: Date.now(),
  }),
  generateSessionToken: vi.fn().mockReturnValue('mock-session-token'),
  createSession: vi
    .fn()
    .mockResolvedValue({ id: 'session-id', expiresAt: new Date(Date.now() + 86400000) }),
  setSessionTokenCookie: vi.fn(),
  upsertOAuthConnection: vi.fn(),
  findAuthenticationAccount: vi
    .fn()
    .mockImplementation(() => Promise.resolve(mockExistingAuthAccount.value)),
  findUserByEmail: vi.fn().mockImplementation(() => Promise.resolve(mockExistingUserByEmail.value)),
  createAuthenticationAccount: vi.fn().mockResolvedValue(undefined),
  updateAuthenticationAccount: vi.fn().mockResolvedValue(undefined),
}));

// Mock auth/providers
vi.mock('$lib/server/auth/providers', () => ({
  getProviderClient: vi.fn().mockReturnValue({
    validateAuthorizationCode: vi.fn().mockResolvedValue({
      accessToken: () => 'mock-access-token',
      hasRefreshToken: () => false,
      refreshToken: () => null,
    }),
  }),
}));

// Mock handle-generator
vi.mock('$lib/server/auth/handle-generator', () => ({
  validateHandle: vi.fn().mockImplementation(() => Promise.resolve(mockHandleValidation.value)),
}));

// Mock database
vi.mock('$lib/server/database', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(() => {
          if (mockDbInsertError.value) {
            return Promise.reject(mockDbInsertError.value);
          }
          return Promise.resolve([mockDbInsertResult.value]);
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

vi.mock('@tribunal/database/schema', () => ({
  user: { id: 'id', username: 'username', email: 'email' },
}));

vi.mock('$lib/server/github/access', () => ({
  invalidateGitHubAccessCache: vi.fn().mockResolvedValue(undefined),
}));

// Mock global fetch for GitHub API
const mockFetch = Object.assign(vi.fn(), { preconnect: () => {} });
global.fetch = mockFetch as unknown as typeof fetch;

function mockGitHubApiResponses(options: {
  githubUser?: Partial<{ id: number; login: string; name: string; avatar_url: string }>;
  emails?: Array<{ email: string; primary: boolean; verified: boolean }>;
  emailsStatus?: number;
}) {
  const githubUser = {
    id: 12345,
    login: 'testuser',
    name: 'Test User',
    avatar_url: 'https://example.com/avatar.png',
    ...options.githubUser,
  };

  const emailsOk = (options.emailsStatus ?? 200) === 200;

  mockFetch.mockImplementation((url: string) => {
    if (url === 'https://api.github.com/user') {
      return Promise.resolve({
        ok: true,
        headers: { get: () => 'repo,user:email' },
        json: () => Promise.resolve(githubUser),
      });
    }
    if (url === 'https://api.github.com/user/emails') {
      if (!emailsOk) {
        return Promise.resolve({
          ok: false,
          status: options.emailsStatus,
          text: () => Promise.resolve('Forbidden'),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.emails ?? []),
      });
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}

// Import handler after mocks
import { GET } from './+server';
import { createAuthenticationAccount } from '$lib/server/auth/authentication';
import { validateHandle } from '$lib/server/auth/handle-generator';

function createRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/login/github/callback');
  url.searchParams.set('code', 'test-code');
  url.searchParams.set('state', 'test-nonce');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const cookies = new Map<string, string>();
  return {
    url,
    cookies: {
      get: (name: string) => cookies.get(name),
      set: vi.fn((name: string, value: string) => cookies.set(name, value)),
      delete: vi.fn((name: string) => cookies.delete(name)),
    },
    locals: mockLocals.value,
  };
}

async function expectRedirect(
  fn: () => unknown | Promise<unknown>,
  location: string,
  status = 302,
) {
  return expect(Promise.resolve(fn())).rejects.toMatchObject({
    type: 'redirect',
    status,
    location,
  });
}

describe('GET /login/github/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistingAuthAccount.value = null;
    mockExistingUserByEmail.value = null;
    mockHandleValidation.value = { valid: true };
    mockDbInsertResult.value = { id: 42, username: 'testuser' };
    mockDbInsertError.value = null;
    mockLocals.value = { user: null, session: null };
  });

  describe('unverified / missing email acceptance', () => {
    it('does not redirect to email_required when emails API returns 403', async () => {
      mockGitHubApiResponses({ emailsStatus: 403 });
      const req = createRequest();

      // Should NOT throw email_required - should proceed to auto-handle or onboarding
      await expectRedirect(() => GET(req as any), '/');
    });

    it('does not redirect to email_required when only unverified emails exist', async () => {
      mockGitHubApiResponses({
        emails: [{ email: 'user@example.com', primary: true, verified: false }],
      });
      const req = createRequest();

      await expectRedirect(() => GET(req as any), '/');
    });

    it('does not redirect to email_required when no emails returned', async () => {
      mockGitHubApiResponses({ emails: [] });
      const req = createRequest();

      await expectRedirect(() => GET(req as any), '/');
    });
  });

  describe('auto-handle path', () => {
    it('creates user with GitHub login when handle is valid and available', async () => {
      mockGitHubApiResponses({
        emails: [{ email: 'user@example.com', primary: true, verified: true }],
      });
      const req = createRequest();

      await expectRedirect(() => GET(req as any), '/');

      expect(validateHandle).toHaveBeenCalledWith('testuser');
      expect(createAuthenticationAccount).toHaveBeenCalledWith(42, 'github', {
        providerUserId: '12345',
        providerUsername: 'testuser',
        email: 'user@example.com',
      });
    });

    it('lowercases GitHub login for handle', async () => {
      mockGitHubApiResponses({
        githubUser: { login: 'TestUser' },
        emails: [{ email: 'user@example.com', primary: true, verified: true }],
      });
      const req = createRequest();

      await expectRedirect(() => GET(req as any), '/');

      expect(validateHandle).toHaveBeenCalledWith('testuser');
    });

    it('redirects with handle_unavailable error when handle is taken/invalid', async () => {
      mockHandleValidation.value = { valid: false, error: 'This handle is already taken' };
      mockGitHubApiResponses({
        emails: [{ email: 'user@example.com', primary: true, verified: true }],
      });
      const req = createRequest();

      await expectRedirect(() => GET(req as any), '/login?error=handle_unavailable');
    });

    it('redirects with handle_unavailable error on unique constraint race condition', async () => {
      const dbError = new Error('duplicate key value violates unique constraint');
      Object.assign(dbError, { code: '23505' });
      mockDbInsertError.value = dbError;

      mockGitHubApiResponses({
        emails: [{ email: 'user@example.com', primary: true, verified: true }],
      });
      const req = createRequest();

      await expectRedirect(() => GET(req as any), '/login?error=handle_unavailable');
    });

    it('redirects with handle_unavailable when handle invalid and no verified email', async () => {
      mockHandleValidation.value = { valid: false, error: 'taken' };
      mockGitHubApiResponses({
        emails: [{ email: 'unverified@example.com', primary: true, verified: false }],
      });
      const req = createRequest();

      await expectRedirect(() => GET(req as any), '/login?error=handle_unavailable');
    });

    it('redirects with handle_unavailable when handle invalid and emails API fails', async () => {
      mockHandleValidation.value = { valid: false, error: 'taken' };
      mockGitHubApiResponses({ emailsStatus: 403 });
      const req = createRequest();

      await expectRedirect(() => GET(req as any), '/login?error=handle_unavailable');
    });
  });

  describe('email auto-linking', () => {
    it('auto-links when verified email matches existing user', async () => {
      mockExistingUserByEmail.value = { id: 10, username: 'existing' };
      mockGitHubApiResponses({
        emails: [{ email: 'existing@example.com', primary: true, verified: true }],
      });
      const req = createRequest();

      await expectRedirect(() => GET(req as any), '/');

      expect(createAuthenticationAccount).toHaveBeenCalledWith(10, 'github', {
        providerUserId: '12345',
        providerUsername: 'testuser',
        email: 'existing@example.com',
      });
    });
  });

  describe('email conflict', () => {
    it('redirects with email_conflict when unverified email matches existing user', async () => {
      mockExistingUserByEmail.value = { id: 10, username: 'existing' };
      mockGitHubApiResponses({
        emails: [{ email: 'existing@example.com', primary: true, verified: false }],
      });
      const req = createRequest();

      await expectRedirect(() => GET(req as any), '/login?error=email_conflict');
    });

    it('does not redirect with email_conflict when unverified email has no match', async () => {
      mockExistingUserByEmail.value = null;
      mockGitHubApiResponses({
        emails: [{ email: 'new@example.com', primary: true, verified: false }],
      });
      const req = createRequest();

      // Should proceed to auto-handle or onboarding, not email_conflict
      await expectRedirect(() => GET(req as any), '/');
    });
  });
});
