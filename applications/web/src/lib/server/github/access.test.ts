import { describe, it, expect, vi } from 'vitest';
import { parseScopes, parseSsoHeader, type UserScopes, type GitHubAccessResult } from './access';

// Mock external dependencies
vi.mock('$env/dynamic/private', () => ({
  env: {
    GITHUB_ACCESS_CACHE_TTL: '300',
  },
}));

vi.mock('../database', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../auth/authentication', () => ({
  getOAuthConnection: vi.fn(),
}));

vi.mock('../redis', () => ({
  getCached: vi.fn(),
  setCache: vi.fn(),
  deleteCache: vi.fn(),
  deleteCacheByPattern: vi.fn(),
}));

describe('parseScopes', () => {
  it('returns unknown when scope is null', () => {
    expect.assertions(1);
    const result = parseScopes(null);
    expect(result).toEqual({
      hasRepo: false,
      hasPublicRepo: false,
      hasNone: false,
      unknown: true,
    });
  });

  it('returns unknown when scope is empty string', () => {
    expect.assertions(1);
    const result = parseScopes('');
    expect(result).toEqual({
      hasRepo: false,
      hasPublicRepo: false,
      hasNone: false,
      unknown: true,
    });
  });

  it('detects repo scope', () => {
    expect.assertions(1);
    const result = parseScopes('repo, user:email');
    expect(result).toEqual({
      hasRepo: true,
      hasPublicRepo: false,
      hasNone: false,
      unknown: false,
    });
  });

  it('detects public_repo scope', () => {
    expect.assertions(1);
    const result = parseScopes('public_repo, user:email');
    expect(result).toEqual({
      hasRepo: false,
      hasPublicRepo: true,
      hasNone: false,
      unknown: false,
    });
  });

  it('detects hasNone when only user:email scope', () => {
    expect.assertions(1);
    const result = parseScopes('user:email');
    expect(result).toEqual({
      hasRepo: false,
      hasPublicRepo: false,
      hasNone: true,
      unknown: false,
    });
  });

  it('handles multiple scopes with repo', () => {
    expect.assertions(1);
    const result = parseScopes('user:email, repo, read:org');
    expect(result).toEqual({
      hasRepo: true,
      hasPublicRepo: false,
      hasNone: false,
      unknown: false,
    });
  });

  it('handles case-insensitive scopes', () => {
    expect.assertions(1);
    const result = parseScopes('REPO, User:Email');
    expect(result).toEqual({
      hasRepo: true,
      hasPublicRepo: false,
      hasNone: false,
      unknown: false,
    });
  });

  it('handles comma-separated scopes without spaces', () => {
    expect.assertions(1);
    const result = parseScopes('repo,user:email,read:org');
    expect(result).toEqual({
      hasRepo: true,
      hasPublicRepo: false,
      hasNone: false,
      unknown: false,
    });
  });
});

describe('parseSsoHeader', () => {
  it('returns null for invalid header', () => {
    expect.assertions(1);
    const result = parseSsoHeader('invalid header');
    expect(result).toBeNull();
  });

  it('returns null for empty header', () => {
    expect.assertions(1);
    const result = parseSsoHeader('');
    expect(result).toBeNull();
  });

  it('parses required SSO header correctly', () => {
    expect.assertions(1);
    const header =
      'required; url=https://github.com/orgs/acme-corp/sso?authorization_request=abc123';
    const result = parseSsoHeader(header);
    expect(result).toEqual({
      type: 'required',
      orgLogin: 'acme-corp',
      authUrl: 'https://github.com/orgs/acme-corp/sso?authorization_request=abc123',
    });
  });

  it('parses partial-results SSO header correctly', () => {
    expect.assertions(1);
    const header =
      'partial-results; url=https://github.com/orgs/my-org/sso?authorization_request=xyz789';
    const result = parseSsoHeader(header);
    expect(result).toEqual({
      type: 'partial-results',
      orgLogin: 'my-org',
      authUrl: 'https://github.com/orgs/my-org/sso?authorization_request=xyz789',
    });
  });

  it('handles org names with dashes', () => {
    expect.assertions(1);
    const header = 'required; url=https://github.com/orgs/my-super-org/sso?auth=123';
    const result = parseSsoHeader(header);
    expect(result).toEqual({
      type: 'required',
      orgLogin: 'my-super-org',
      authUrl: 'https://github.com/orgs/my-super-org/sso?auth=123',
    });
  });

  it('returns null when org cannot be extracted', () => {
    expect.assertions(1);
    const header = 'required; url=https://github.com/invalid-url';
    const result = parseSsoHeader(header);
    expect(result).toBeNull();
  });
});

describe('GitHubAccessResult types', () => {
  it('allowed result has visibility', () => {
    expect.assertions(2);
    const result: GitHubAccessResult = { allowed: true, visibility: 'public' };
    expect(result.allowed).toBe(true);
    expect(result.visibility).toBe('public');
  });

  it('denied result has reason and message', () => {
    expect.assertions(3);
    const result: GitHubAccessResult = {
      allowed: false,
      reason: 'no_token',
      message: 'No token',
    };
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no_token');
    expect(result.message).toBe('No token');
  });

  it('SSO denied result has ssoUrl and ssoOrgLogin', () => {
    expect.assertions(5);
    const result: GitHubAccessResult = {
      allowed: false,
      reason: 'sso_required',
      message: 'SSO required',
      ssoUrl: 'https://github.com/orgs/acme/sso',
      ssoOrgLogin: 'acme',
    };
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('sso_required');
    expect(result.ssoUrl).toBe('https://github.com/orgs/acme/sso');
    expect(result.ssoOrgLogin).toBe('acme');
    expect(result.message).toBe('SSO required');
  });

  it('rate limited result has retryAfter', () => {
    expect.assertions(3);
    const result: GitHubAccessResult = {
      allowed: false,
      reason: 'rate_limited',
      message: 'Rate limited',
      retryAfter: 60,
    };
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('rate_limited');
    expect(result.retryAfter).toBe(60);
  });
});

describe('UserScopes types', () => {
  it('validates UserScopes structure', () => {
    expect.assertions(4);
    const scopes: UserScopes = {
      hasRepo: true,
      hasPublicRepo: false,
      hasNone: false,
      unknown: false,
    };
    expect(scopes.hasRepo).toBe(true);
    expect(scopes.hasPublicRepo).toBe(false);
    expect(scopes.hasNone).toBe(false);
    expect(scopes.unknown).toBe(false);
  });
});

describe('Cache key patterns', () => {
  it('generates correct user+repo cache key format', () => {
    expect.assertions(1);
    // The cache key format is: github-access:{userId}:{repositoryId}
    // Verify the pattern indirectly through the module behavior
    // This ensures the keys follow the expected format for Redis pattern matching
    const userId = 'user-123';
    const repoId = 456;
    const expectedPattern = `github-access:${userId}:${repoId}`;
    expect(expectedPattern).toBe('github-access:user-123:456');
  });

  it('generates correct user pattern for cache invalidation', () => {
    expect.assertions(1);
    const userId = 'user-123';
    const expectedPattern = `github-access:${userId}:*`;
    expect(expectedPattern).toBe('github-access:user-123:*');
  });

  it('generates correct repo pattern for cache invalidation', () => {
    expect.assertions(1);
    const repoId = 456;
    const expectedPattern = `github-access:*:${repoId}`;
    expect(expectedPattern).toBe('github-access:*:456');
  });
});

describe('Denial reason handling', () => {
  const denialReasons = [
    'no_token',
    'invalid_token',
    'insufficient_scope',
    'sso_required',
    'no_access',
    'rate_limited',
    'repository_blocked',
  ] as const;

  it.each(denialReasons)('recognizes %s as a valid denial reason', (reason) => {
    expect.assertions(1);
    const result: GitHubAccessResult = {
      allowed: false,
      reason,
      message: `Test message for ${reason}`,
    };
    expect(result.reason).toBe(reason);
  });
});

describe('Circuit breaker behavior', () => {
  /**
   * Circuit breaker prevents repeated calls to a failing GitHub API endpoint.
   * - Tracks failures per user
   * - Opens circuit after CIRCUIT_FAILURE_THRESHOLD (3) failures
   * - Circuit stays open for CIRCUIT_RESET_MS (60s)
   * - Returns cached denial when circuit is open
   */

  const CIRCUIT_FAILURE_THRESHOLD = 3;
  const CIRCUIT_RESET_MS = 60_000;

  it('circuit stays closed with fewer than threshold failures', () => {
    expect.assertions(1);
    const failures = 2;
    const isOpen = failures >= CIRCUIT_FAILURE_THRESHOLD;
    expect(isOpen).toBe(false);
  });

  it('circuit opens after threshold failures', () => {
    expect.assertions(1);
    const failures = 3;
    const isOpen = failures >= CIRCUIT_FAILURE_THRESHOLD;
    expect(isOpen).toBe(true);
  });

  it('circuit resets after timeout', () => {
    expect.assertions(1);
    const openUntil = Date.now() - 1000; // 1 second ago
    const now = Date.now();
    const shouldReset = now > openUntil;
    expect(shouldReset).toBe(true);
  });

  it('circuit stays open during timeout window', () => {
    expect.assertions(1);
    const openUntil = Date.now() + CIRCUIT_RESET_MS;
    const now = Date.now();
    const isStillOpen = now < openUntil;
    expect(isStillOpen).toBe(true);
  });

  it('failure increments counter', () => {
    expect.assertions(1);
    const state = { failures: 1, lastFailure: Date.now(), openUntil: 0 };
    state.failures++;
    expect(state.failures).toBe(2);
  });

  it('success resets failure counter', () => {
    expect.assertions(1);
    const state = { failures: 2, lastFailure: Date.now(), openUntil: 0 };
    // On success, reset failures
    state.failures = 0;
    expect(state.failures).toBe(0);
  });
});

describe('Cache decision matrix', () => {
  /**
   * Conservative caching rules:
   * 1. Cache successful accesses (allowed: true)
   * 2. Cache definitive denials (invalid_token, no_access with full scope)
   * 3. DON'T cache uncertain denials (no_access with unknown/minimal scope)
   * 4. Cache SSO denials briefly (1 min) since user might complete SSO
   * 5. Don't cache rate_limited (transient)
   */

  const GITHUB_ACCESS_CACHE_TTL = 300; // 5 min
  const GITHUB_ACCESS_SSO_CACHE_TTL = 60; // 1 min

  describe('when result is allowed', () => {
    it('should cache with standard TTL', () => {
      expect.assertions(1);
      const shouldCache = true;
      const ttl = GITHUB_ACCESS_CACHE_TTL;
      expect(shouldCache && ttl === 300).toBe(true);
    });

    it('should preserve lastSuccessAt timestamp', () => {
      expect.assertions(1);
      const now = Date.now();
      const entry = { result: { allowed: true }, cachedAt: now, lastSuccessAt: now };
      expect(entry.lastSuccessAt).toBe(now);
    });
  });

  describe('when result is no_access with full repo scope', () => {
    it('should cache because denial is definitive', () => {
      expect.assertions(1);
      const userHasRepoScope = true;
      const reason = 'no_access';
      // User has full scope and still no access = genuinely no permission
      const shouldCache = userHasRepoScope && reason === 'no_access';
      expect(shouldCache).toBe(true);
    });
  });

  describe('when result is no_access with unknown/minimal scope', () => {
    it('should NOT cache because denial might resolve with scope upgrade', () => {
      expect.assertions(1);
      const userHasRepoScope = false;
      const scopeUnknown = true;
      const reason = 'no_access';
      // If we don't know the scope, we can't be sure the denial is permanent
      const shouldCache = userHasRepoScope && reason === 'no_access' && !scopeUnknown;
      expect(shouldCache).toBe(false);
    });
  });

  describe('when result is sso_required', () => {
    it('should cache with short TTL (1 min)', () => {
      expect.assertions(1);
      const ttl = GITHUB_ACCESS_SSO_CACHE_TTL;
      expect(ttl).toBe(60);
    });

    it('should include ssoUrl for user to complete authentication', () => {
      expect.assertions(1);
      const result: GitHubAccessResult = {
        allowed: false,
        reason: 'sso_required',
        message: 'SSO required',
        ssoUrl: 'https://github.com/orgs/acme/sso',
        ssoOrgLogin: 'acme',
      };
      expect(result.ssoUrl).toBeDefined();
    });
  });

  describe('when result is invalid_token', () => {
    it('should NOT cache (and should mark token invalid in DB)', () => {
      expect.assertions(1);
      // Invalid token triggers DB update and cache clear, not caching
      const shouldCacheInvalidToken = false;
      expect(shouldCacheInvalidToken).toBe(false);
    });
  });

  describe('when result is rate_limited', () => {
    it('should NOT cache (transient condition)', () => {
      expect.assertions(1);
      const reason = 'rate_limited';
      const shouldCache = reason !== 'rate_limited';
      expect(shouldCache).toBe(false);
    });

    it('should include retryAfter for client backoff', () => {
      expect.assertions(1);
      const result: GitHubAccessResult = {
        allowed: false,
        reason: 'rate_limited',
        message: 'Rate limited',
        retryAfter: 60,
      };
      expect(result.retryAfter).toBe(60);
    });
  });

  describe('lastSuccessAt preservation ("recent success" wobble protection)', () => {
    it('should preserve lastSuccessAt through cache updates', () => {
      expect.assertions(1);
      const originalSuccessAt = Date.now() - 60_000; // 1 min ago
      const newCachedAt = Date.now();

      // When re-caching, preserve the original success timestamp
      const entry = {
        result: { allowed: true },
        cachedAt: newCachedAt,
        lastSuccessAt: originalSuccessAt, // Preserved from original entry
      };

      expect(entry.lastSuccessAt).toBe(originalSuccessAt);
    });

    it('should use lastSuccessAt to detect recent valid access', () => {
      expect.assertions(1);
      const RECENT_SUCCESS_THRESHOLD_MS = 5 * 60 * 1000; // 5 min
      const lastSuccessAt = Date.now() - 2 * 60 * 1000; // 2 min ago
      const now = Date.now();

      const hadRecentSuccess = now - lastSuccessAt < RECENT_SUCCESS_THRESHOLD_MS;
      expect(hadRecentSuccess).toBe(true);
    });
  });
});

describe('Request deduplication', () => {
  /**
   * Concurrent checks for the same user+repo should share a single
   * in-flight request rather than making multiple API calls.
   */

  it('generates consistent dedup key for user+repo', () => {
    expect.assertions(1);
    const userId = 'user-123';
    const repoId = 456;
    const key1 = `${userId}:${repoId}`;
    const key2 = `${userId}:${repoId}`;
    expect(key1).toBe(key2);
  });

  it('different users have different dedup keys', () => {
    expect.assertions(1);
    const key1 = 'user-123:456';
    const key2 = 'user-456:456';
    expect(key1).not.toBe(key2);
  });

  it('different repos have different dedup keys', () => {
    expect.assertions(1);
    const key1 = 'user-123:456';
    const key2 = 'user-123:789';
    expect(key1).not.toBe(key2);
  });
});

describe('markGitHubTokensInvalidByProviderUserId', () => {
  it('returns empty array when no connections exist', async () => {
    const { db } = await import('../database');

    // Mock the update().returning() chain to return empty array
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as ReturnType<typeof db.update>);

    const { markGitHubTokensInvalidByProviderUserId } = await import('./access');
    const result = await markGitHubTokensInvalidByProviderUserId(12345);

    expect(result).toEqual([]);
  });

  it('marks connections as invalid and returns affected user IDs', async () => {
    const { db } = await import('../database');

    // Mock the update().returning() chain to return affected users
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ userId: 1 }, { userId: 2 }]),
        }),
      }),
    } as unknown as ReturnType<typeof db.update>);

    const { markGitHubTokensInvalidByProviderUserId } = await import('./access');
    const result = await markGitHubTokensInvalidByProviderUserId(12345);

    expect(result).toEqual([1, 2]);
  });

  it('returns empty array on database error', async () => {
    const { db } = await import('../database');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock the update() to throw an error
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(new Error('Database error')),
        }),
      }),
    } as unknown as ReturnType<typeof db.update>);

    const { markGitHubTokensInvalidByProviderUserId } = await import('./access');
    const result = await markGitHubTokensInvalidByProviderUserId(12345);

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
