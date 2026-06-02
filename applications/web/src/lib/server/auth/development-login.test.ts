import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks (test-level access) ────────────────────────────────

const { mockEnv, mockDev } = vi.hoisted(() => ({
  mockEnv: {
    GITHUB_TOKEN: 'ghp_test123',
    DEV_GITHUB_TOKEN_LOGIN: undefined as string | undefined,
    E2E_TEST_MODE: undefined as string | undefined,
    CI: undefined as string | undefined,
    GITHUB_CLIENT_ID: 'test-client-id',
    GITHUB_CLIENT_SECRET: 'test-client-secret',
    ENCRYPTION_KEY: 'a'.repeat(64),
  },
  mockDev: { value: true },
}));

const {
  mockFindAuthenticationAccount,
  mockFindUserByEmail,
  mockCreateAuthenticationAccount,
  mockUpdateAuthenticationAccount,
  mockGenerateSessionToken,
  mockCreateSession,
  mockSetSessionTokenCookie,
  mockUpsertOAuthConnection,
} = vi.hoisted(() => ({
  mockFindAuthenticationAccount: vi.fn(),
  mockFindUserByEmail: vi.fn(),
  mockCreateAuthenticationAccount: vi.fn(),
  mockUpdateAuthenticationAccount: vi.fn(),
  mockGenerateSessionToken: vi.fn(() => 'mock-session-token'),
  mockCreateSession: vi.fn(() =>
    Promise.resolve({ id: 'session-id', expiresAt: new Date('2025-02-15') }),
  ),
  mockSetSessionTokenCookie: vi.fn(),
  mockUpsertOAuthConnection: vi.fn(),
}));

const { mockValidateHandle } = vi.hoisted(() => ({
  mockValidateHandle: vi.fn(() => Promise.resolve({ valid: true })),
}));

const { mockDbInsertReturning, mockDbUpdateWhere } = vi.hoisted(() => ({
  mockDbInsertReturning: vi.fn(() => Promise.resolve([{ id: 42, username: 'octocat' }])),
  mockDbUpdateWhere: vi.fn(() => Promise.resolve()),
}));

const { mockInvalidateGitHubAccessCache } = vi.hoisted(() => ({
  mockInvalidateGitHubAccessCache: vi.fn(),
}));

// ── Module mocks ─────────────────────────────────────────────────────

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({
  get dev() {
    return mockDev.value;
  },
}));

vi.mock('$lib/server/auth/authentication', () => ({
  findAuthenticationAccount: mockFindAuthenticationAccount,
  findUserByEmail: mockFindUserByEmail,
  createAuthenticationAccount: mockCreateAuthenticationAccount,
  updateAuthenticationAccount: mockUpdateAuthenticationAccount,
  generateSessionToken: mockGenerateSessionToken,
  createSession: mockCreateSession,
  setSessionTokenCookie: mockSetSessionTokenCookie,
  upsertOAuthConnection: mockUpsertOAuthConnection,
}));

vi.mock('$lib/server/auth/handle-generator', () => ({
  validateHandle: mockValidateHandle,
}));

vi.mock('$lib/server/github/access', () => ({
  invalidateGitHubAccessCache: mockInvalidateGitHubAccessCache,
}));

vi.mock('$lib/server/database', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockDbInsertReturning,
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: mockDbUpdateWhere,
      })),
    })),
  },
}));

vi.mock('@tribunal/database/schema', () => ({
  user: { id: 'user.id' },
}));

// ── Helpers ──────────────────────────────────────────────────────────

function makeGitHubUserResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 12345,
    login: 'octocat',
    name: 'Mona Lisa',
    avatar_url: 'https://github.com/images/octocat.png',
    ...overrides,
  };
}

function makeGitHubEmailsResponse() {
  return [
    { email: 'octocat@github.com', primary: true, verified: true },
    { email: 'mona@example.com', primary: false, verified: false },
  ];
}

function mockFetchResponses(
  userBody: Record<string, unknown> | null,
  emailsBody: Array<Record<string, unknown>> | null,
  options: { scopes?: string } = {},
) {
  const original = globalThis.fetch;
  const mock = Object.assign(
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/user/emails') && emailsBody) {
        return new Response(JSON.stringify(emailsBody), { status: 200 });
      }
      if (url.includes('/user') && userBody) {
        const headers: Record<string, string> = {};
        if (options.scopes !== undefined) {
          headers['X-OAuth-Scopes'] = options.scopes;
        }
        return new Response(JSON.stringify(userBody), { status: 200, headers });
      }
      if (url.includes('/user') && !userBody) {
        return new Response('Unauthorized', { status: 401 });
      }
      return original(input as RequestInfo);
    }),
    { preconnect: () => {} },
  );
  globalThis.fetch = mock as typeof fetch;
}

function makeMockEvent() {
  return { cookies: { set: vi.fn() } } as unknown as import('@sveltejs/kit').RequestEvent;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('isDevTokenLoginEnabled', () => {
  beforeEach(() => {
    mockDev.value = true;
    mockEnv.GITHUB_TOKEN = 'ghp_test123';
    mockEnv.DEV_GITHUB_TOKEN_LOGIN = '1';
    mockEnv.E2E_TEST_MODE = undefined;
    mockEnv.CI = undefined;
  });

  it('returns true when all conditions met', async () => {
    const { isDevTokenLoginEnabled } = await import('./development-login');
    expect(isDevTokenLoginEnabled()).toBe(true);
  });

  it('returns false in production', async () => {
    mockDev.value = false;
    const { isDevTokenLoginEnabled } = await import('./development-login');
    expect(isDevTokenLoginEnabled()).toBe(false);
  });

  it('returns false without explicit opt-in flag', async () => {
    mockEnv.DEV_GITHUB_TOKEN_LOGIN = undefined;
    const { isDevTokenLoginEnabled } = await import('./development-login');
    expect(isDevTokenLoginEnabled()).toBe(false);
  });

  it('returns false without GITHUB_TOKEN', async () => {
    mockEnv.GITHUB_TOKEN = undefined as unknown as string;
    const { isDevTokenLoginEnabled } = await import('./development-login');
    expect(isDevTokenLoginEnabled()).toBe(false);
  });

  it('returns false in E2E test mode', async () => {
    mockEnv.E2E_TEST_MODE = '1';
    const { isDevTokenLoginEnabled } = await import('./development-login');
    expect(isDevTokenLoginEnabled()).toBe(false);
  });

  it('returns false in CI', async () => {
    mockEnv.CI = '1';
    const { isDevTokenLoginEnabled } = await import('./development-login');
    expect(isDevTokenLoginEnabled()).toBe(false);
  });
});

describe('bootstrapSessionFromGitHubToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDev.value = true;
    mockEnv.GITHUB_TOKEN = 'ghp_test123';
    mockEnv.DEV_GITHUB_TOKEN_LOGIN = '1';
    mockEnv.E2E_TEST_MODE = undefined;
    mockEnv.CI = undefined;
    mockFindAuthenticationAccount.mockResolvedValue(null);
    mockFindUserByEmail.mockResolvedValue(null);
    mockValidateHandle.mockResolvedValue({ valid: true });
    mockDbInsertReturning.mockResolvedValue([{ id: 42, username: 'octocat' }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('signs in existing user by auth account', async () => {
    mockFetchResponses(makeGitHubUserResponse(), makeGitHubEmailsResponse());
    mockFindAuthenticationAccount.mockResolvedValue({
      id: 1,
      userId: 10,
      provider: 'github',
      providerUserId: '12345',
    });

    const { bootstrapSessionFromGitHubToken } = await import('./development-login');
    const event = makeMockEvent();
    const result = await bootstrapSessionFromGitHubToken(event);

    expect(result).toBe(true);
    expect(mockUpdateAuthenticationAccount).toHaveBeenCalledWith(1, 10, {
      providerUsername: 'octocat',
      email: 'octocat@github.com',
    });
    expect(mockUpsertOAuthConnection).toHaveBeenCalledWith(10, 'github', {
      providerUserId: '12345',
      accessToken: 'ghp_test123',
      refreshToken: null,
      expiresAt: null,
      scope: 'repo,user:email',
    });
    expect(mockInvalidateGitHubAccessCache).toHaveBeenCalledWith(10);
    expect(mockCreateSession).toHaveBeenCalled();
    expect(mockSetSessionTokenCookie).toHaveBeenCalled();
  });

  it('auto-links by verified email to existing user', async () => {
    mockFetchResponses(makeGitHubUserResponse(), makeGitHubEmailsResponse());
    mockFindAuthenticationAccount.mockResolvedValue(null);
    mockFindUserByEmail.mockResolvedValue({ id: 20, email: 'octocat@github.com' });

    const { bootstrapSessionFromGitHubToken } = await import('./development-login');
    const result = await bootstrapSessionFromGitHubToken(makeMockEvent());

    expect(result).toBe(true);
    expect(mockCreateAuthenticationAccount).toHaveBeenCalledWith(20, 'github', {
      providerUserId: '12345',
      providerUsername: 'octocat',
      email: 'octocat@github.com',
    });
    expect(mockUpsertOAuthConnection).toHaveBeenCalledWith(20, 'github', {
      providerUserId: '12345',
      accessToken: 'ghp_test123',
      refreshToken: null,
      expiresAt: null,
      scope: 'repo,user:email',
    });
    expect(mockInvalidateGitHubAccessCache).toHaveBeenCalledWith(20);
    expect(mockCreateSession).toHaveBeenCalled();
  });

  it('creates new user when no match found', async () => {
    mockFetchResponses(makeGitHubUserResponse(), makeGitHubEmailsResponse());

    const { bootstrapSessionFromGitHubToken } = await import('./development-login');
    const result = await bootstrapSessionFromGitHubToken(makeMockEvent());

    expect(result).toBe(true);
    expect(mockValidateHandle).toHaveBeenCalledWith('octocat');
    expect(mockDbInsertReturning).toHaveBeenCalled();
    expect(mockCreateAuthenticationAccount).toHaveBeenCalledWith(42, 'github', {
      providerUserId: '12345',
      providerUsername: 'octocat',
      email: 'octocat@github.com',
    });
    expect(mockUpsertOAuthConnection).toHaveBeenCalledWith(42, 'github', {
      providerUserId: '12345',
      accessToken: 'ghp_test123',
      refreshToken: null,
      expiresAt: null,
      scope: 'repo,user:email',
    });
    expect(mockInvalidateGitHubAccessCache).toHaveBeenCalledWith(42);
    expect(mockCreateSession).toHaveBeenCalled();
  });

  it('returns false when token is invalid', async () => {
    mockFetchResponses(null, null);

    const { bootstrapSessionFromGitHubToken } = await import('./development-login');
    const result = await bootstrapSessionFromGitHubToken(makeMockEvent());

    expect(result).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('returns false when handle is unavailable', async () => {
    mockFetchResponses(makeGitHubUserResponse(), makeGitHubEmailsResponse());
    mockValidateHandle.mockResolvedValue({ valid: false });

    const { bootstrapSessionFromGitHubToken } = await import('./development-login');
    const result = await bootstrapSessionFromGitHubToken(makeMockEvent());

    expect(result).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('handles username becoming unavailable between validation and insert (23505)', async () => {
    mockFetchResponses(makeGitHubUserResponse(), makeGitHubEmailsResponse());

    const duplicateKeyError = Object.assign(
      new Error('duplicate key value violates unique constraint "users_username_key"'),
      { code: '23505' } as { code: string },
    );
    mockDbInsertReturning.mockRejectedValueOnce(duplicateKeyError);

    const { bootstrapSessionFromGitHubToken } = await import('./development-login');
    const result = await bootstrapSessionFromGitHubToken(makeMockEvent());

    expect(result).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('handles race when auth account is created concurrently during email auto-link', async () => {
    mockFetchResponses(makeGitHubUserResponse(), makeGitHubEmailsResponse());
    mockFindAuthenticationAccount.mockResolvedValue(null);
    mockFindUserByEmail.mockResolvedValue({ id: 20, email: 'octocat@github.com' });

    const raceError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    } as { code: string });
    mockCreateAuthenticationAccount.mockRejectedValueOnce(raceError);

    const { bootstrapSessionFromGitHubToken } = await import('./development-login');
    const result = await bootstrapSessionFromGitHubToken(makeMockEvent());

    expect(result).toBe(true);
    expect(mockCreateAuthenticationAccount).toHaveBeenCalledWith(20, 'github', {
      providerUserId: '12345',
      providerUsername: 'octocat',
      email: 'octocat@github.com',
    });
    // Should still sign in despite race condition
    expect(mockCreateSession).toHaveBeenCalled();
  });

  it('handles race when auth account is created concurrently during new user creation', async () => {
    mockFetchResponses(makeGitHubUserResponse(), makeGitHubEmailsResponse());

    const raceError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    } as { code: string });
    mockCreateAuthenticationAccount.mockRejectedValueOnce(raceError);

    const { bootstrapSessionFromGitHubToken } = await import('./development-login');
    const result = await bootstrapSessionFromGitHubToken(makeMockEvent());

    expect(result).toBe(true);
    expect(mockDbInsertReturning).toHaveBeenCalled();
    expect(mockCreateAuthenticationAccount).toHaveBeenCalledWith(42, 'github', {
      providerUserId: '12345',
      providerUsername: 'octocat',
      email: 'octocat@github.com',
    });
    // Should still sign in despite auth account race condition — user record is valid
    expect(mockCreateSession).toHaveBeenCalled();
    expect(mockUpsertOAuthConnection).toHaveBeenCalled();
  });

  it('prevents duplicate accounts with unverified email', async () => {
    // Only unverified emails in the response
    const unverifiedEmails = [{ email: 'existing@example.com', primary: true, verified: false }];
    mockFetchResponses(makeGitHubUserResponse(), unverifiedEmails);
    mockFindAuthenticationAccount.mockResolvedValue(null);
    // First call for email auto-link (no verified email, so skipped)
    // Second call for duplicate prevention
    mockFindUserByEmail.mockResolvedValue({ id: 30, email: 'existing@example.com' });

    const { bootstrapSessionFromGitHubToken } = await import('./development-login');
    const result = await bootstrapSessionFromGitHubToken(makeMockEvent());

    expect(result).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockDbInsertReturning).not.toHaveBeenCalled();
  });

  it('captures X-OAuth-Scopes header from GitHub API response', async () => {
    mockFetchResponses(makeGitHubUserResponse(), makeGitHubEmailsResponse(), {
      scopes: 'repo,read:org,user:email',
    });
    mockFindAuthenticationAccount.mockResolvedValue({
      id: 1,
      userId: 10,
      provider: 'github',
      providerUserId: '12345',
    });

    const { bootstrapSessionFromGitHubToken } = await import('./development-login');
    await bootstrapSessionFromGitHubToken(makeMockEvent());

    expect(mockUpsertOAuthConnection).toHaveBeenCalledWith(10, 'github', {
      providerUserId: '12345',
      accessToken: 'ghp_test123',
      refreshToken: null,
      expiresAt: null,
      scope: 'repo,read:org,user:email',
    });
  });
});
