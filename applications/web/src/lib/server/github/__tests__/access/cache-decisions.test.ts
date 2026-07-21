/**
 * Tests for cache decision matrix.
 * Verifies which results get cached and with what TTL.
 */

// 1. Mocks FIRST (before any other imports)
import './register-access-mocks';

// 2. Vitest
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 3. Module under test
import {
  shouldCacheDenial,
  verifyGitHubRepositoryAccess,
  type GitHubAccessResult,
} from '../../access';

// 4. Test utilities
import {
  setupDefaultMocks,
  setupMockDbForRepo,
  mockGlobalFetch,
  TEST_ID_RANGES,
  TEST_OWNER,
  TEST_REPO,
  TEST_TOKEN,
  mockGetOAuthConnection,
  mockGetCached,
  mockSetCache,
} from './access.test-utilities';

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Cache decision matrix', () => {
  // Use unique IDs for each test to avoid state collision
  const { USER: baseUserId, REPO: baseRepoId } = TEST_ID_RANGES.CACHE_DECISIONS;

  it('caches allowed result with repo scope', async () => {
    const cacheUserId = baseUserId + 1;
    const cacheRepoId = baseRepoId + 1;

    expect.assertions(2);

    // Mock DB for unique IDs
    setupMockDbForRepo(cacheRepoId, TEST_OWNER, TEST_REPO);

    mockGlobalFetch().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({ private: false }),
    });

    await verifyGitHubRepositoryAccess(cacheUserId, cacheRepoId);

    expect(mockSetCache).toHaveBeenCalled();
    const [, entry] = mockSetCache.mock.calls[0];
    expect(entry.result.allowed).toBe(true);
  });

  it('caches no_access denial with full repo scope', async () => {
    const cacheUserId = baseUserId + 2;
    const cacheRepoId = baseRepoId + 2;

    expect.assertions(3);

    // Mock DB for unique IDs
    setupMockDbForRepo(cacheRepoId, TEST_OWNER, TEST_REPO);

    // User has full repo scope
    mockGetOAuthConnection.mockResolvedValue({
      accessToken: TEST_TOKEN,
      scope: 'repo, user:email',
    });

    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      });

    const result = await verifyGitHubRepositoryAccess(cacheUserId, cacheRepoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('no_access');
    }
    expect(mockSetCache).toHaveBeenCalled();
  });

  it('does NOT cache no_access denial with unknown scope', async () => {
    const cacheUserId = baseUserId + 3;
    const cacheRepoId = baseRepoId + 3;

    expect.assertions(3);

    // Mock DB for unique IDs
    setupMockDbForRepo(cacheRepoId, TEST_OWNER, TEST_REPO);

    // User has unknown scope
    mockGetOAuthConnection.mockResolvedValue({
      accessToken: TEST_TOKEN,
      scope: null,
    });

    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      });

    const result = await verifyGitHubRepositoryAccess(cacheUserId, cacheRepoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      // Returns insufficient_scope instead of no_access when scope unknown
      expect(result.reason).toBe('insufficient_scope');
    }
    // Should NOT cache insufficient_scope
    expect(mockSetCache).not.toHaveBeenCalled();
  });

  it('does NOT cache invalid_token denial', async () => {
    const cacheUserId = baseUserId + 4;
    const cacheRepoId = baseRepoId + 4;

    expect.assertions(2);

    // Mock DB for unique IDs
    setupMockDbForRepo(cacheRepoId, TEST_OWNER, TEST_REPO);

    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
      });

    const result = await verifyGitHubRepositoryAccess(cacheUserId, cacheRepoId);

    expect(result.allowed).toBe(false);
    // Should not cache - only deleteCache called for invalidation
    expect(mockSetCache).not.toHaveBeenCalled();
  });

  it('caches sso_required denial with short TTL', async () => {
    const cacheUserId = baseUserId + 5;
    const cacheRepoId = baseRepoId + 5;

    expect.assertions(3);

    // Mock DB for unique IDs
    setupMockDbForRepo(cacheRepoId, TEST_OWNER, TEST_REPO);

    const ssoUrl = 'https://github.com/orgs/sso-org/sso?auth=123';
    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({
          'X-GitHub-SSO': `required; url=${ssoUrl}`,
        }),
      });

    const result = await verifyGitHubRepositoryAccess(cacheUserId, cacheRepoId);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('sso_required');
    }
    // Should cache with short TTL (60 seconds)
    expect(mockSetCache).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        result: expect.objectContaining({ reason: 'sso_required' }),
      }),
      60, // SSO cache TTL
    );
  });

  it('does NOT cache rate_limited denial', async () => {
    const cacheUserId = baseUserId + 6;
    const cacheRepoId = baseRepoId + 6;

    expect.assertions(2);

    // Mock DB for unique IDs
    setupMockDbForRepo(cacheRepoId, TEST_OWNER, TEST_REPO);

    mockGlobalFetch()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '60' }),
      });

    const result = await verifyGitHubRepositoryAccess(cacheUserId, cacheRepoId);

    expect(result.allowed).toBe(false);
    // Should not cache rate_limited
    expect(mockSetCache).not.toHaveBeenCalled();
  });
});

describe('shouldCacheDenial (defensive arms unreachable via the public flow)', () => {
  const fullScopes = {
    hasRepo: true,
    hasPublicRepo: false,
    hasNone: false,
    unknown: false,
  };

  it('never caches an invalid_token denial', () => {
    expect(shouldCacheDenial('invalid_token', fullScopes, undefined)).toEqual({
      cache: false,
      ttl: 0,
    });
  });

  it('never caches a no_token denial', () => {
    expect(shouldCacheDenial('no_token', fullScopes, undefined)).toEqual({
      cache: false,
      ttl: 0,
    });
  });

  it('never caches an unrecognized denial reason', () => {
    const unrecognized = 'not-a-real-reason' as Parameters<typeof shouldCacheDenial>[0];

    expect(shouldCacheDenial(unrecognized, fullScopes, undefined)).toEqual({
      cache: false,
      ttl: 0,
    });
  });
});

describe('Cache edge cases', () => {
  const { USER: baseUserId, REPO: baseRepoId } = TEST_ID_RANGES.CACHE_DECISIONS;

  it('returns cached result when available', async () => {
    const cacheUserId = baseUserId + 10;
    const cacheRepoId = baseRepoId + 10;

    expect.assertions(3);

    setupMockDbForRepo(cacheRepoId, TEST_OWNER, TEST_REPO);

    const cachedResult: GitHubAccessResult = { allowed: true, visibility: 'private' };
    mockGetCached.mockResolvedValue({
      result: cachedResult,
      cachedAt: Date.now(),
      lastSuccessAt: Date.now(),
    });

    mockGlobalFetch();

    const result = await verifyGitHubRepositoryAccess(cacheUserId, cacheRepoId);

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.visibility).toBe('private');
    }
    // Should not have called fetch because result was cached
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('bypasses cache when skipCache option is true', async () => {
    const cacheUserId = baseUserId + 11;
    const cacheRepoId = baseRepoId + 11;

    expect.assertions(2);

    setupMockDbForRepo(cacheRepoId, TEST_OWNER, TEST_REPO);

    const cachedResult: GitHubAccessResult = {
      allowed: false,
      reason: 'no_access',
      message: 'Cached denial',
    };
    mockGetCached.mockResolvedValue({
      result: cachedResult,
      cachedAt: Date.now(),
    });

    mockGlobalFetch().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({ private: false }),
    });

    const result = await verifyGitHubRepositoryAccess(cacheUserId, cacheRepoId, {
      skipCache: true,
    });

    expect(result.allowed).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('does NOT cache a fresh no_access denial when the user had recent success (GitHub wobble)', async () => {
    const cacheUserId = baseUserId + 20;
    const cacheRepoId = baseRepoId + 20;

    expect.assertions(2);

    setupMockDbForRepo(cacheRepoId, TEST_OWNER, TEST_REPO);
    mockGetOAuthConnection.mockResolvedValue({
      accessToken: TEST_TOKEN,
      scope: 'repo, user:email',
    });
    // skipCache bypasses the top-level cached-result short-circuit while
    // still exercising resolveAndVerifyAccess's own lastSuccessAt lookup from
    // the same cache entry.
    mockGetCached.mockResolvedValue({
      result: { allowed: false, reason: 'no_access', message: 'Cached denial' },
      cachedAt: Date.now(),
      lastSuccessAt: Date.now() - 60_000, // 1 minute ago — well within the hour window
    });
    mockGlobalFetch()
      .mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers() })
      .mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers() });

    const result = await verifyGitHubRepositoryAccess(cacheUserId, cacheRepoId, {
      skipCache: true,
    });

    expect(result.allowed).toBe(false);
    expect(mockSetCache).not.toHaveBeenCalled();
  });

  it('does NOT cache a no_access denial when the user also holds public_repo scope (minimal-scope upgrade path)', async () => {
    const cacheUserId = baseUserId + 21;
    const cacheRepoId = baseRepoId + 21;

    expect.assertions(2);

    setupMockDbForRepo(cacheRepoId, TEST_OWNER, TEST_REPO);
    // Holds both 'repo' and 'public_repo' -- hasMinimalScope is true even
    // though hasRepo is also true, so the denial might resolve with a scope
    // upgrade and must not be cached as definitive.
    mockGetOAuthConnection.mockResolvedValue({
      accessToken: TEST_TOKEN,
      scope: 'repo, public_repo, user:email',
    });
    mockGetCached.mockResolvedValue(null);
    mockGlobalFetch()
      .mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers() })
      .mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers() });

    const result = await verifyGitHubRepositoryAccess(cacheUserId, cacheRepoId);

    expect(result.allowed).toBe(false);
    expect(mockSetCache).not.toHaveBeenCalled();
  });
});
