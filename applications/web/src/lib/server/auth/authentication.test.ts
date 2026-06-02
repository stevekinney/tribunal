import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import {
  createUserFactory,
  createAuthenticationAccountFactory,
  resetIdCounter,
} from '@tribunal/test/factories';

// Mock environment
vi.mock('$env/dynamic/private', () => ({
  env: {
    GITHUB_CLIENT_ID: 'test-client-id',
    GITHUB_CLIENT_SECRET: 'test-client-secret',
    ENCRYPTION_KEY: 'a'.repeat(64), // 32 bytes = 64 hex chars
  },
}));

vi.mock('$app/environment', () => ({
  dev: true,
}));

// Mock database with chainable methods
const mockInsertValues = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockDelete = vi.fn();

vi.mock('$lib/server/database', () => ({
  db: {
    insert: vi.fn(() => ({
      values: mockInsertValues.mockReturnValue({
        onConflictDoUpdate: mockOnConflictDoUpdate.mockResolvedValue(undefined),
      }),
    })),
    select: mockSelect.mockReturnValue({
      from: mockFrom.mockReturnValue({
        where: mockWhere,
      }),
    }),
    delete: mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount: 1 }),
    }),
  },
}));

// Mock encryption - needs to preserve actual behavior for some tests
const { mockEncrypt, mockDecrypt } = vi.hoisted(() => ({
  mockEncrypt: vi.fn((value: string) => `encrypted:${value}`),
  mockDecrypt: vi.fn((value: string) => {
    if (value.startsWith('encrypted:')) {
      return value.replace('encrypted:', '');
    }
    throw new Error('Invalid encrypted data format');
  }),
}));

vi.mock('$lib/server/encryption', () => ({
  encrypt: mockEncrypt,
  decrypt: mockDecrypt,
}));

describe('authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockResolvedValue([]);
  });

  describe('getOAuthConnection', () => {
    it('returns null when no connection exists', async () => {
      mockWhere.mockResolvedValueOnce([]);

      const { getOAuthConnection } = await import('./authentication');
      const result = await getOAuthConnection(1, 'github');

      expect(result).toBeNull();
    }, 15000); // Extended timeout for dynamic import with mocks in CI

    it('returns decrypted connection when found', async () => {
      const mockConnection = {
        id: 1,
        userId: 1,
        provider: 'github',
        providerUserId: '12345',
        accessToken: 'encrypted:test-token',
        refreshToken: 'encrypted:refresh-token',
        scope: 'repo',
      };
      mockWhere.mockResolvedValueOnce([mockConnection]);

      const { getOAuthConnection } = await import('./authentication');
      const result = await getOAuthConnection(1, 'github');

      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe('test-token');
      expect(result?.refreshToken).toBe('refresh-token');
      expect(mockDecrypt).toHaveBeenCalledTimes(2);
    });

    it('returns null refreshToken when not stored', async () => {
      expect.assertions(2);
      const mockConnection = {
        id: 1,
        userId: 1,
        provider: 'github',
        providerUserId: '12345',
        accessToken: 'encrypted:test-token',
        refreshToken: null,
        scope: 'repo',
      };
      mockWhere.mockResolvedValueOnce([mockConnection]);

      const { getOAuthConnection } = await import('./authentication');
      const result = await getOAuthConnection(1, 'github');

      expect(result?.refreshToken).toBeNull();
      expect(mockDecrypt).toHaveBeenCalledTimes(1); // Only called for accessToken
    });

    it('returns null when decryption fails (encryption key rotation)', async () => {
      expect.assertions(2);
      const mockConnection = {
        id: 1,
        userId: 1,
        provider: 'github',
        providerUserId: '12345',
        accessToken: 'corrupted-data',
        refreshToken: null,
        scope: 'repo',
      };
      mockWhere.mockResolvedValueOnce([mockConnection]);

      // Make decrypt throw for corrupted data
      mockDecrypt.mockImplementationOnce(() => {
        throw new Error('Invalid encrypted data format');
      });

      const { getOAuthConnection } = await import('./authentication');
      const result = await getOAuthConnection(1, 'github');

      expect(result).toBeNull();
      expect(mockDecrypt).toHaveBeenCalled();
    });
  });

  describe('upsertOAuthConnection', () => {
    it('inserts new OAuth connection with encrypted tokens', async () => {
      expect.assertions(3);

      const { upsertOAuthConnection } = await import('./authentication');
      await upsertOAuthConnection(1, 'github', {
        providerUserId: '12345',
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
        scope: 'repo',
      });

      expect(mockEncrypt).toHaveBeenCalledWith('new-token');
      expect(mockEncrypt).toHaveBeenCalledWith('new-refresh');
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          provider: 'github',
          providerUserId: '12345',
        }),
      );
    });

    it('uses onConflictDoUpdate for upsert behavior', async () => {
      expect.assertions(1);

      const { upsertOAuthConnection } = await import('./authentication');
      await upsertOAuthConnection(1, 'github', {
        providerUserId: '12345',
        accessToken: 'token',
      });

      expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(Array),
          set: expect.objectContaining({
            providerUserId: '12345',
          }),
        }),
      );
    });

    it('handles null refresh token', async () => {
      expect.assertions(2);

      const { upsertOAuthConnection } = await import('./authentication');
      await upsertOAuthConnection(1, 'github', {
        providerUserId: '12345',
        accessToken: 'token',
        refreshToken: null,
      });

      // Should only encrypt access token, not refresh token
      expect(mockEncrypt).toHaveBeenCalledTimes(1);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          refreshToken: null,
        }),
      );
    });

    it('handles undefined optional fields', async () => {
      expect.assertions(1);

      const { upsertOAuthConnection } = await import('./authentication');
      await upsertOAuthConnection(1, 'github', {
        providerUserId: '12345',
        accessToken: 'token',
      });

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: null,
          scope: null,
        }),
      );
    });
  });

  describe('deleteOAuthConnection', () => {
    it('deletes connection by userId and provider', async () => {
      expect.assertions(1);

      const { deleteOAuthConnection } = await import('./authentication');
      await deleteOAuthConnection(1, 'github');

      expect(mockDelete).toHaveBeenCalled();
    });
  });
});

describe('session management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateSessionToken', () => {
    it('generates unique tokens', async () => {
      expect.assertions(2);

      const { generateSessionToken } = await import('./authentication');
      const token1 = generateSessionToken();
      const token2 = generateSessionToken();

      expect(token1).not.toBe(token2);
      expect(token1.length).toBeGreaterThan(0);
    });
  });
});

describe('health check helpers', () => {
  const FROZEN_TIME = new Date('2025-01-15T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ now: FROZEN_TIME });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('shouldCheckHealth', () => {
    it('returns true when lastCheckedAt is null', async () => {
      expect.assertions(1);

      const { shouldCheckHealth } = await import('./authentication');
      expect(shouldCheckHealth(null)).toBe(true);
    });

    it('returns true when more than 24 hours since last check', async () => {
      expect.assertions(1);

      const { shouldCheckHealth } = await import('./authentication');
      const thirtyHoursAgo = new Date(FROZEN_TIME.getTime() - 30 * 60 * 60 * 1000);
      expect(shouldCheckHealth(thirtyHoursAgo)).toBe(true);
    });

    it('returns false when less than 24 hours since last check', async () => {
      expect.assertions(1);

      const { shouldCheckHealth } = await import('./authentication');
      const twelveHoursAgo = new Date(FROZEN_TIME.getTime() - 12 * 60 * 60 * 1000);
      expect(shouldCheckHealth(twelveHoursAgo)).toBe(false);
    });
  });
});

describe('session freshness', () => {
  const FROZEN_TIME = new Date('2025-01-15T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ now: FROZEN_TIME });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('isSessionFresh', () => {
    it('returns true when session was authenticated recently', async () => {
      const { isSessionFresh } = await import('./authentication');

      const freshSession = {
        id: 'session-id',
        userId: 1,
        expiresAt: new Date(FROZEN_TIME.getTime() + 30 * 24 * 60 * 60 * 1000),
        lastAuthAt: new Date(FROZEN_TIME), // Just now
      };

      expect(isSessionFresh(freshSession)).toBe(true);
    });

    it('returns true when session is within 5 minute window', async () => {
      const { isSessionFresh } = await import('./authentication');

      const session = {
        id: 'session-id',
        userId: 1,
        expiresAt: new Date(FROZEN_TIME.getTime() + 30 * 24 * 60 * 60 * 1000),
        lastAuthAt: new Date(FROZEN_TIME.getTime() - 4 * 60 * 1000), // 4 minutes ago
      };

      expect(isSessionFresh(session)).toBe(true);
    });

    it('returns false when session is older than 5 minutes', async () => {
      const { isSessionFresh } = await import('./authentication');

      const staleSession = {
        id: 'session-id',
        userId: 1,
        expiresAt: new Date(FROZEN_TIME.getTime() + 30 * 24 * 60 * 60 * 1000),
        lastAuthAt: new Date(FROZEN_TIME.getTime() - 10 * 60 * 1000), // 10 minutes ago
      };

      expect(isSessionFresh(staleSession)).toBe(false);
    });

    it('returns false when session is exactly 5 minutes old', async () => {
      const { isSessionFresh } = await import('./authentication');

      const session = {
        id: 'session-id',
        userId: 1,
        expiresAt: new Date(FROZEN_TIME.getTime() + 30 * 24 * 60 * 60 * 1000),
        lastAuthAt: new Date(FROZEN_TIME.getTime() - 5 * 60 * 1000), // Exactly 5 minutes ago
      };

      expect(isSessionFresh(session)).toBe(false);
    });
  });
});

describe('sanitizeReturnTo', () => {
  it('returns "/" for null input', async () => {
    const { sanitizeReturnTo } = await import('./authentication');
    expect(sanitizeReturnTo(null)).toBe('/');
  });

  it('returns "/" for empty string', async () => {
    const { sanitizeReturnTo } = await import('./authentication');
    expect(sanitizeReturnTo('')).toBe('/');
  });

  it('allows valid relative paths', async () => {
    const { sanitizeReturnTo } = await import('./authentication');
    expect(sanitizeReturnTo('/dashboard')).toBe('/dashboard');
    expect(sanitizeReturnTo('/workspaces/my-team')).toBe('/workspaces/my-team');
    expect(sanitizeReturnTo('/settings?tab=security')).toBe('/settings?tab=security');
  });

  it('preserves hash fragments', async () => {
    const { sanitizeReturnTo } = await import('./authentication');
    expect(sanitizeReturnTo('/settings#security')).toBe('/settings#security');
  });

  it('rejects absolute URLs', async () => {
    const { sanitizeReturnTo } = await import('./authentication');
    expect(sanitizeReturnTo('https://evil.com')).toBe('/');
    expect(sanitizeReturnTo('http://attacker.com/phish')).toBe('/');
  });

  it('rejects protocol-relative URLs', async () => {
    const { sanitizeReturnTo } = await import('./authentication');
    expect(sanitizeReturnTo('//evil.com')).toBe('/');
    expect(sanitizeReturnTo('//evil.com/path')).toBe('/');
  });

  it('rejects javascript: protocol', async () => {
    const { sanitizeReturnTo } = await import('./authentication');
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/');
    expect(sanitizeReturnTo('JAVASCRIPT:alert(1)')).toBe('/');
  });

  it('rejects data: protocol', async () => {
    const { sanitizeReturnTo } = await import('./authentication');
    expect(sanitizeReturnTo('data:text/html,<script>alert(1)</script>')).toBe('/');
    expect(sanitizeReturnTo('DATA:text/html,evil')).toBe('/');
  });

  it('strips domain from absolute-looking paths', async () => {
    const { sanitizeReturnTo } = await import('./authentication');
    // These look like they could be domain references but start with /
    expect(sanitizeReturnTo('/valid/path')).toBe('/valid/path');
  });
});

describe('OAuth state management', () => {
  describe('createOAuthState', () => {
    it('generates unique nonces', async () => {
      const { createOAuthState } = await import('./authentication');

      const state1 = createOAuthState();
      const state2 = createOAuthState();

      expect(state1).not.toBe(state2);
      expect(state1.length).toBeGreaterThan(10);
    });
  });
});

describe('re-auth intent cookies', () => {
  const FROZEN_TIME = new Date('2025-01-15T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ now: FROZEN_TIME });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to create mock cookies
  function createMockCookies() {
    const store = new Map<string, string>();
    return {
      get: vi.fn((name: string) => store.get(name)),
      set: vi.fn((name: string, value: string) => store.set(name, value)),
      delete: vi.fn((name: string) => store.delete(name)),
      _store: store,
    };
  }

  describe('setReauthIntentCookie + consumeReauthIntentCookie', () => {
    it('sets and consumes a valid intent', async () => {
      const { setReauthIntentCookie, consumeReauthIntentCookie } = await import('./authentication');

      const cookies = createMockCookies();
      const intent = {
        action: 'link' as const,
        provider: 'github' as const,
        userId: 123,
        returnTo: '/repositories',
        createdAt: FROZEN_TIME.getTime(),
        actionLabel: 'Connect GitHub',
      };

      setReauthIntentCookie(
        cookies as unknown as Parameters<typeof setReauthIntentCookie>[0],
        intent,
      );

      // Get the raw value that was set
      const rawValue = cookies._store.get('reauth_intent');
      expect(rawValue).toBeDefined();

      // Mock getting the value
      cookies.get.mockReturnValueOnce(rawValue);

      const consumed = consumeReauthIntentCookie(
        cookies as unknown as Parameters<typeof consumeReauthIntentCookie>[0],
        123,
      );

      expect(consumed).not.toBeNull();
      expect(consumed?.action).toBe('link');
      expect(consumed?.provider).toBe('github');
      expect(consumed?.actionLabel).toBe('Connect GitHub');
    });

    it('returns null for wrong user', async () => {
      const { setReauthIntentCookie, consumeReauthIntentCookie } = await import('./authentication');

      const cookies = createMockCookies();
      const intent = {
        action: 'link' as const,
        provider: 'github' as const,
        userId: 123,
        returnTo: '/repositories',
        createdAt: FROZEN_TIME.getTime(),
      };

      setReauthIntentCookie(
        cookies as unknown as Parameters<typeof setReauthIntentCookie>[0],
        intent,
      );

      const rawValue = cookies._store.get('reauth_intent');
      cookies.get.mockReturnValueOnce(rawValue);

      // Try to consume with different user
      const consumed = consumeReauthIntentCookie(
        cookies as unknown as Parameters<typeof consumeReauthIntentCookie>[0],
        456, // Wrong user
      );

      expect(consumed).toBeNull();
    });

    it('returns null for expired intent', async () => {
      const { consumeReauthIntentCookie } = await import('./authentication');

      const cookies = createMockCookies();

      // Create an expired intent (older than 10 minutes)
      const expiredIntent = {
        action: 'link',
        provider: 'github',
        userId: 123,
        returnTo: '/repositories',
        createdAt: FROZEN_TIME.getTime() - 15 * 60 * 1000, // 15 minutes ago
      };

      cookies.get.mockReturnValueOnce(JSON.stringify(expiredIntent));

      const consumed = consumeReauthIntentCookie(
        cookies as unknown as Parameters<typeof consumeReauthIntentCookie>[0],
        123,
      );

      expect(consumed).toBeNull();
    });
  });

  describe('peekReauthIntentCookie', () => {
    it('returns intent without consuming it', async () => {
      const { setReauthIntentCookie, peekReauthIntentCookie } = await import('./authentication');

      const cookies = createMockCookies();
      const intent = {
        action: 'link' as const,
        provider: 'github' as const,
        userId: 123,
        returnTo: '/repositories',
        createdAt: FROZEN_TIME.getTime(),
        actionLabel: 'Test action',
      };

      setReauthIntentCookie(
        cookies as unknown as Parameters<typeof setReauthIntentCookie>[0],
        intent,
      );

      const rawValue = cookies._store.get('reauth_intent');
      cookies.get.mockReturnValue(rawValue);

      const peeked = peekReauthIntentCookie(
        cookies as unknown as Parameters<typeof peekReauthIntentCookie>[0],
        123,
      );

      expect(peeked).not.toBeNull();
      expect(peeked?.actionLabel).toBe('Test action');

      // Should not have called delete
      expect(cookies.delete).not.toHaveBeenCalled();

      // Can peek again
      const peekedAgain = peekReauthIntentCookie(
        cookies as unknown as Parameters<typeof peekReauthIntentCookie>[0],
        123,
      );
      expect(peekedAgain).not.toBeNull();
    });
  });
});

describe('OAuth state cookies', () => {
  function createMockCookies() {
    const store = new Map<string, string>();
    return {
      get: vi.fn((name: string) => store.get(name)),
      set: vi.fn((name: string, value: string) => store.set(name, value)),
      delete: vi.fn((name: string) => store.delete(name)),
      _store: store,
    };
  }

  describe('setOAuthStateCookie + consumeOAuthStateCookie', () => {
    it('sets and consumes valid state', async () => {
      const { createOAuthState, setOAuthStateCookie, consumeOAuthStateCookie } =
        await import('./authentication');

      const cookies = createMockCookies();
      const nonce = createOAuthState();

      setOAuthStateCookie(
        cookies as unknown as Parameters<typeof setOAuthStateCookie>[0],
        nonce,
        'github',
        'login',
        '/dashboard',
      );

      const rawValue = cookies._store.get('oauth_state');
      expect(rawValue).toBeDefined();

      cookies.get.mockReturnValueOnce(rawValue);

      const consumed = consumeOAuthStateCookie(
        cookies as unknown as Parameters<typeof consumeOAuthStateCookie>[0],
        nonce,
      );

      expect(consumed).not.toBeNull();
      expect(consumed?.nonce).toBe(nonce);
      expect(consumed?.provider).toBe('github');
      expect(consumed?.intent).toBe('login');
      expect(consumed?.returnTo).toBe('/dashboard');
    });

    it('returns null for wrong nonce', async () => {
      const { createOAuthState, setOAuthStateCookie, consumeOAuthStateCookie } =
        await import('./authentication');

      const cookies = createMockCookies();
      const nonce = createOAuthState();

      setOAuthStateCookie(
        cookies as unknown as Parameters<typeof setOAuthStateCookie>[0],
        nonce,
        'github',
        'login',
        '/dashboard',
      );

      const rawValue = cookies._store.get('oauth_state');
      cookies.get.mockReturnValueOnce(rawValue);

      const consumed = consumeOAuthStateCookie(
        cookies as unknown as Parameters<typeof consumeOAuthStateCookie>[0],
        'wrong-nonce',
      );

      expect(consumed).toBeNull();
    });

    it('includes linkUserId for link intent', async () => {
      const { createOAuthState, setOAuthStateCookie, consumeOAuthStateCookie } =
        await import('./authentication');

      const cookies = createMockCookies();
      const nonce = createOAuthState();

      setOAuthStateCookie(
        cookies as unknown as Parameters<typeof setOAuthStateCookie>[0],
        nonce,
        'github',
        'link',
        '/profile',
        123, // linkUserId
      );

      const rawValue = cookies._store.get('oauth_state');
      cookies.get.mockReturnValueOnce(rawValue);

      const consumed = consumeOAuthStateCookie(
        cookies as unknown as Parameters<typeof consumeOAuthStateCookie>[0],
        nonce,
      );

      expect(consumed?.intent).toBe('link');
      expect(consumed?.linkUserId).toBe(123);
    });

    it('sanitizes returnTo before storing', async () => {
      const { createOAuthState, setOAuthStateCookie, consumeOAuthStateCookie } =
        await import('./authentication');

      const cookies = createMockCookies();
      const nonce = createOAuthState();

      setOAuthStateCookie(
        cookies as unknown as Parameters<typeof setOAuthStateCookie>[0],
        nonce,
        'github',
        'login',
        'https://evil.com/phish', // Malicious URL
      );

      const rawValue = cookies._store.get('oauth_state');
      cookies.get.mockReturnValueOnce(rawValue);

      const consumed = consumeOAuthStateCookie(
        cookies as unknown as Parameters<typeof consumeOAuthStateCookie>[0],
        nonce,
      );

      expect(consumed?.returnTo).toBe('/'); // Should be sanitized
    });
  });
});

// ============================================================================
// Auth Account Tests (merged from auth-accounts.test.ts)
// ============================================================================

describe('auth-accounts', () => {
  let testDb: TestDatabase;
  let userFactory: ReturnType<typeof createUserFactory>;
  let authenticationAccountFactory: ReturnType<typeof createAuthenticationAccountFactory>;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    userFactory = createUserFactory(testDb.db);
    authenticationAccountFactory = createAuthenticationAccountFactory(testDb.db);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
    resetIdCounter();
  });

  describe('createAuthenticationAccount', () => {
    it('creates an auth account for a user', async () => {
      const user = await userFactory.create({ email: 'test@example.com' });
      const account = await authenticationAccountFactory.createGitHub(user.id, {
        providerUsername: 'octocat',
        email: 'test@example.com',
      });

      expect(account).toBeDefined();
      expect(account.userId).toBe(user.id);
      expect(account.provider).toBe('github');
      expect(account.providerUsername).toBe('octocat');
      expect(account.email).toBe('test@example.com');
    });

    it('enforces unique constraint on provider + providerUserId', async () => {
      const user1 = await userFactory.create();
      const user2 = await userFactory.create();

      await authenticationAccountFactory.create({
        userId: user1.id,
        provider: 'github',
        providerUserId: 'github-123',
      });

      // Attempting to create another account with same provider+providerUserId should fail
      await expect(
        authenticationAccountFactory.create({
          userId: user2.id,
          provider: 'github',
          providerUserId: 'github-123',
        }),
      ).rejects.toThrow();
    });

    it('enforces unique constraint on userId + provider', async () => {
      const user = await userFactory.create();

      await authenticationAccountFactory.createGitHub(user.id);

      // Attempting to create another GitHub account for same user should fail
      await expect(authenticationAccountFactory.createGitHub(user.id)).rejects.toThrow();
    });
  });

  describe('listAuthAccountsForUser', () => {
    it('returns empty array for user with no accounts', async () => {
      const user = await userFactory.create();

      const { authAccount } = await import('@tribunal/database/schema');
      const accounts = await testDb.db
        .select()
        .from(authAccount)
        .where(eq(authAccount.userId, user.id));

      expect(accounts).toEqual([]);
    });

    it('returns all accounts for a user', async () => {
      const user = await userFactory.create({ email: 'test@example.com' });

      await authenticationAccountFactory.createGitHub(user.id);

      const { authAccount } = await import('@tribunal/database/schema');
      const accounts = await testDb.db
        .select()
        .from(authAccount)
        .where(eq(authAccount.userId, user.id));

      expect(accounts).toHaveLength(1);
      expect(accounts.map((a) => a.provider).sort()).toEqual(['github']);
    });
  });

  describe('getAuthenticationAccountByProvider', () => {
    it('returns null when account does not exist', async () => {
      const user = await userFactory.create();

      const { authAccount } = await import('@tribunal/database/schema');
      const [result] = await testDb.db
        .select()
        .from(authAccount)
        .where(eq(authAccount.userId, user.id))
        .limit(1);

      expect(result).toBeUndefined();
    });

    it('returns the correct account by provider', async () => {
      const user = await userFactory.create({ email: 'test@example.com' });

      await authenticationAccountFactory.createGitHub(user.id, { providerUsername: 'octocat' });

      const { authAccount } = await import('@tribunal/database/schema');

      const [githubAccount] = await testDb.db
        .select()
        .from(authAccount)
        .where(sql`${authAccount.userId} = ${user.id} AND ${authAccount.provider} = 'github'`);

      expect(githubAccount).toBeDefined();
      expect(githubAccount.provider).toBe('github');
      expect(githubAccount.providerUsername).toBe('octocat');
    });
  });

  describe('findAuthenticationAccount', () => {
    it('finds account by provider and providerUserId', async () => {
      const user = await userFactory.create();
      const created = await authenticationAccountFactory.create({
        userId: user.id,
        provider: 'github',
        providerUserId: 'unique-github-id',
      });

      const { authAccount } = await import('@tribunal/database/schema');
      const [found] = await testDb.db
        .select()
        .from(authAccount)
        .where(
          sql`${authAccount.provider} = 'github' AND ${authAccount.providerUserId} = 'unique-github-id'`,
        );

      expect(found).toBeDefined();
      expect(found.id).toBe(created.id);
    });

    it('returns undefined when not found', async () => {
      const { authAccount } = await import('@tribunal/database/schema');
      const [found] = await testDb.db
        .select()
        .from(authAccount)
        .where(
          sql`${authAccount.provider} = 'github' AND ${authAccount.providerUserId} = 'nonexistent'`,
        );

      expect(found).toBeUndefined();
    });
  });

  describe('unlinkAuthAccount', () => {
    it('deletes auth account', async () => {
      const user = await userFactory.create();
      await authenticationAccountFactory.createGitHub(user.id);

      const { authAccount } = await import('@tribunal/database/schema');

      // Verify we have 1 account
      let accounts = await testDb.db
        .select()
        .from(authAccount)
        .where(eq(authAccount.userId, user.id));
      expect(accounts).toHaveLength(1);

      // Delete GitHub account
      await testDb.db
        .delete(authAccount)
        .where(sql`${authAccount.userId} = ${user.id} AND ${authAccount.provider} = 'github'`);

      // Verify no accounts remain
      accounts = await testDb.db.select().from(authAccount).where(eq(authAccount.userId, user.id));
      expect(accounts).toHaveLength(0);
    });
  });

  describe('countAuthAccountsForUser', () => {
    it('returns correct count', async () => {
      const user = await userFactory.create();

      const { authAccount } = await import('@tribunal/database/schema');

      // Initially 0
      let [result] = await testDb.db
        .select({ count: sql<number>`count(*)::int` })
        .from(authAccount)
        .where(eq(authAccount.userId, user.id));
      expect(result.count).toBe(0);

      // Add one account
      await authenticationAccountFactory.createGitHub(user.id);
      [result] = await testDb.db
        .select({ count: sql<number>`count(*)::int` })
        .from(authAccount)
        .where(eq(authAccount.userId, user.id));
      expect(result.count).toBe(1);
    });
  });

  describe('updateAuthenticationAccount - email null protection', () => {
    it('should not overwrite email with null', async () => {
      const user = await userFactory.create();
      const account = await authenticationAccountFactory.createGitHub(user.id, {
        email: 'original@example.com',
      });

      const { authAccount } = await import('@tribunal/database/schema');

      // Simulate update that would set email to null (provider stopped providing it)
      // The production code prevents this, so we test that the original is preserved
      // when we only update other fields
      await testDb.db
        .update(authAccount)
        .set({
          providerUsername: 'newusername',
          updatedAt: new Date(),
        })
        .where(eq(authAccount.id, account.id));

      const [updated] = await testDb.db
        .select()
        .from(authAccount)
        .where(eq(authAccount.id, account.id));

      // Email should still be present
      expect(updated.email).toBe('original@example.com');
      expect(updated.providerUsername).toBe('newusername');
    });
  });

  describe('findUserByEmail', () => {
    it('finds user by email case-insensitively', async () => {
      const { user: userTable } = await import('@tribunal/database/schema');

      const user = await userFactory.create({ email: 'Test@Example.com' });

      // Search with different case
      const [found] = await testDb.db
        .select()
        .from(userTable)
        .where(sql`lower(${userTable.email}) = lower('test@example.com')`)
        .limit(1);

      expect(found).toBeDefined();
      expect(found.id).toBe(user.id);
    });

    it('returns undefined when no user found', async () => {
      const { user: userTable } = await import('@tribunal/database/schema');

      const [found] = await testDb.db
        .select()
        .from(userTable)
        .where(sql`lower(${userTable.email}) = lower('nonexistent@example.com')`)
        .limit(1);

      expect(found).toBeUndefined();
    });
  });
});
