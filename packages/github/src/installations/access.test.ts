import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, type AllFactories } from '@tribunal/test/factories';
import { oauthConnection } from '@tribunal/database/schema';
import type { Database } from '@tribunal/database';
import type { CacheOperations, GithubServiceContext } from '../context.js';
import {
  type GetOAuthConnection,
  invalidateAllAccessCacheForRepo,
  invalidateGitHubAccessCache,
  markGitHubTokenInvalid,
  markGitHubTokensInvalidByProviderUserId,
  parseScopes,
  parseSsoHeader,
  shouldCacheDenial,
  verifyGitHubRepositoryAccess,
  type GitHubAccessDenialReason,
} from './access.js';

let testDatabase: TestDatabase;
let factories: AllFactories;
let nextUserId = 1;

/** Every test gets a fresh userId so the module-level circuit-breaker and
 * pending-request maps (keyed by `${userId}:${repositoryId}`) never bleed
 * state across tests. */
function uniqueUserId(): number {
  nextUserId += 1;
  return nextUserId;
}

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  factories = createFactories(testDatabase.db);
});

afterAll(async () => {
  await testDatabase.close();
});

beforeEach(async () => {
  await testDatabase.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** In-memory fake matching `CacheOperations`, backed by a real Map so tests
 * can assert genuine cache-hit/cache-miss behavior instead of call-spy shape. */
type FakeCache = CacheOperations & { store: Map<string, unknown> };

function createFakeCache(): FakeCache {
  const store = new Map<string, unknown>();
  const patternToRegExp = (pattern: string) =>
    new RegExp(
      `^${pattern
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`,
    );

  const getCached = vi.fn(async (key: string) =>
    store.has(key) ? store.get(key) : null,
  ) as CacheOperations['getCached'];
  const setCache = vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
    return true;
  }) as CacheOperations['setCache'];
  const setCacheIndefinitely = vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
    return true;
  }) as CacheOperations['setCacheIndefinitely'];
  const deleteCache = vi.fn(async (key: string) => {
    store.delete(key);
    return true;
  }) as CacheOperations['deleteCache'];
  const deleteCacheByPattern = vi.fn(async (pattern: string) => {
    const regex = patternToRegExp(pattern);
    let count = 0;
    for (const key of [...store.keys()]) {
      if (regex.test(key)) {
        store.delete(key);
        count++;
      }
    }
    return count;
  }) as CacheOperations['deleteCacheByPattern'];

  return {
    getCached,
    setCache,
    setCacheIndefinitely,
    deleteCache,
    deleteCacheByPattern,
    resetCacheClient: vi.fn(),
    store,
  };
}

function createContext(
  overrides: Partial<Omit<GithubServiceContext, 'cache'>> & { cache?: FakeCache } = {},
): Omit<GithubServiceContext, 'cache'> & { cache: FakeCache } {
  return {
    db: testDatabase.db as Database,
    cache: createFakeCache(),
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
    getGithubApplication: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const headerMap = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headerMap,
    json: async () => body,
  } as unknown as Response;
}

function connectionOf(accessToken: string, scope: string | null): GetOAuthConnection {
  return vi.fn().mockResolvedValue({ accessToken, scope });
}

describe('shouldCacheDenial (defensive arms unreachable via the public flow)', () => {
  const fullScopes = parseScopes('repo');

  it('never caches an invalid_token denial', () => {
    expect(shouldCacheDenial('invalid_token', fullScopes, undefined, 600)).toEqual({
      cache: false,
      ttl: 0,
    });
  });

  it('never caches a no_token denial', () => {
    expect(shouldCacheDenial('no_token', fullScopes, undefined, 600)).toEqual({
      cache: false,
      ttl: 0,
    });
  });

  it('never caches an unrecognized denial reason', () => {
    const unrecognized = 'not-a-real-reason' as GitHubAccessDenialReason;

    expect(shouldCacheDenial(unrecognized, fullScopes, undefined, 600)).toEqual({
      cache: false,
      ttl: 0,
    });
  });
});

describe('parseScopes', () => {
  it('reports unknown scope when no stored scope string exists', () => {
    expect(parseScopes(null)).toEqual({
      hasRepo: false,
      hasPublicRepo: false,
      hasNone: false,
      unknown: true,
    });
  });

  it('detects the repo scope', () => {
    expect(parseScopes('read:user, repo')).toEqual({
      hasRepo: true,
      hasPublicRepo: false,
      hasNone: false,
      unknown: false,
    });
  });

  it('detects the public_repo scope', () => {
    expect(parseScopes('public_repo')).toEqual({
      hasRepo: false,
      hasPublicRepo: true,
      hasNone: false,
      unknown: false,
    });
  });

  it('detects no relevant scope', () => {
    expect(parseScopes('read:user')).toEqual({
      hasRepo: false,
      hasPublicRepo: false,
      hasNone: true,
      unknown: false,
    });
  });
});

describe('parseSsoHeader', () => {
  it('parses a required SSO header', () => {
    const result = parseSsoHeader(
      'required; url=https://github.com/orgs/acme/sso?authorization_request=abc',
    );
    expect(result).toEqual({
      type: 'required',
      orgLogin: 'acme',
      authUrl: 'https://github.com/orgs/acme/sso?authorization_request=abc',
    });
  });

  it('parses a partial-results SSO header', () => {
    const result = parseSsoHeader('partial-results; url=https://github.com/orgs/acme/sso?x=1');
    expect(result?.type).toBe('partial-results');
  });

  it('returns null for a header that does not match the expected shape', () => {
    expect(parseSsoHeader('bogus header')).toBeNull();
  });

  it('returns null when the URL has no /orgs/ segment', () => {
    expect(parseSsoHeader('required; url=https://github.com/not-orgs/acme')).toBeNull();
  });
});

describe('verifyGitHubRepositoryAccess', () => {
  it('denies access with no_access when the repository does not exist in our database', async () => {
    const userId = uniqueUserId();
    const context = createContext();

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      999_999_999,
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'no_access',
      message: 'Repository not found',
    });
  });

  it('denies access with no_token when the user has no GitHub OAuth connection', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const getOAuthConnection = vi.fn().mockResolvedValue(null);

    const result = await verifyGitHubRepositoryAccess(
      context,
      getOAuthConnection,
      userId,
      repository.id,
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'no_token',
      message: 'Connect GitHub to access this repository',
    });
    // no_token is never cached
    expect(context.cache.setCache).not.toHaveBeenCalled();
  });

  it('allows and caches access to a public repository without hitting the authenticated API', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { private: false }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    expect(result).toEqual({ allowed: true, visibility: 'public' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(context.cache.setCache).toHaveBeenCalled();
  });

  it('falls back to the authenticated check when the public check errors over the network', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse(200, { private: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    expect(result).toEqual({ allowed: true, visibility: 'private' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('allows and caches access to a private repository via the authenticated check', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(200, { private: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    expect(result).toEqual({ allowed: true, visibility: 'private' });

    // A second call is served entirely from cache — no further fetch calls.
    fetchMock.mockClear();
    const cached = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );
    expect(cached).toEqual({ allowed: true, visibility: 'private' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips the cache lookup when skipCache is set', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    context.cache.store.set(`github-access:${userId}:${repository.id}`, {
      result: { allowed: true, visibility: 'public' },
      cachedAt: Date.now(),
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { private: false }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
      { skipCache: true },
    );

    expect(result).toEqual({ allowed: true, visibility: 'public' });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('honors a custom cacheTtl for a cacheable denial', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(404, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
      { cacheTtl: 42 },
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'no_access',
      message: 'Repository not accessible',
    });
    expect(context.cache.setCache).toHaveBeenCalledWith(expect.any(String), expect.anything(), 42);
  });

  it('returns insufficient_scope without caching when a 404 arrives for a token with minimal scope', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(404, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', null),
      userId,
      repository.id,
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'insufficient_scope',
      message: 'This may be a private repository. Sign in again to access it.',
    });
    expect(context.cache.setCache).not.toHaveBeenCalled();
  });

  it('marks the token invalid and clears the user cache on a 401', async () => {
    const user = await factories.user.create();
    await factories.oauthConnection.create({ userId: user.id });
    const repository = await factories.repository.create();
    const context = createContext();
    context.cache.store.set(`github-access:${user.id}:${repository.id + 1}`, {
      result: { allowed: true, visibility: 'public' },
      cachedAt: Date.now(),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('expired-token', 'repo'),
      user.id,
      repository.id,
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'invalid_token',
      message: 'GitHub token expired or revoked',
    });
    const [connection] = await testDatabase.db
      .select()
      .from(oauthConnection)
      .where(eq(oauthConnection.userId, user.id));
    expect(connection.status).toBe('invalid');
    // invalidateGitHubAccessCache(userId) clears every cached entry for the user
    expect(context.cache.store.has(`github-access:${user.id}:${repository.id + 1}`)).toBe(false);
  });

  it('reports sso_required and caches it briefly when the SSO header is present', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(
        jsonResponse(
          403,
          {},
          {
            'X-GitHub-SSO':
              'required; url=https://github.com/orgs/acme/sso?authorization_request=x',
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    expect(result).toMatchObject({
      allowed: false,
      reason: 'sso_required',
      ssoOrgLogin: 'acme',
    });
    expect(context.cache.setCache).toHaveBeenCalledWith(expect.any(String), expect.anything(), 60);
  });

  it('reports rate_limited from a 429 with a Retry-After header', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'Retry-After': '12' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'rate_limited',
      message: 'GitHub API rate limit exceeded. Please try again in 12 seconds.',
      retryAfter: 12,
    });
    expect(context.cache.setCache).not.toHaveBeenCalled();
  });

  it('reports rate_limited from a 403 primary rate limit', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const resetAt = Math.floor(Date.now() / 1000) + 30;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(
        jsonResponse(
          403,
          {},
          { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(resetAt) },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('rate_limited');
    }
  });

  it('reports repository_blocked and caches it for a blocked-access 403', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(403, { message: 'Repository access blocked' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'repository_blocked',
      message: 'This repository has been blocked by GitHub',
    });
    expect(context.cache.setCache).toHaveBeenCalledWith(expect.any(String), expect.anything(), 300);
  });

  it('reports account_suspended for a suspended-account 403', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(403, { message: 'Your account is suspended' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'account_suspended',
      message: 'There is an issue with your GitHub account',
    });
  });

  it('reports insufficient_scope for a 403 with an unparseable body', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers(),
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'insufficient_scope',
      message: 'Token lacks required permissions',
    });
  });

  it('caches genuine no_access for a full-scope token that still gets a 404', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(404, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'no_access',
      message: 'Repository not accessible',
    });
    expect(context.cache.setCache).toHaveBeenCalled();
  });

  it('does not cache no_access when the user had a recent successful check (GitHub wobble)', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    context.cache.store.set(`github-access:${userId}:${repository.id}`, {
      result: { allowed: true, visibility: 'private' },
      cachedAt: Date.now(),
      lastSuccessAt: Date.now(),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(404, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
      { skipCache: true },
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'no_access',
      message: 'Repository not accessible',
    });
    expect(context.cache.setCache).not.toHaveBeenCalled();
  });

  it('does not cache no_access for a full-repo-scope token that also carries public_repo (minimal scope)', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(404, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo,public_repo'),
      userId,
      repository.id,
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'no_access',
      message: 'Repository not accessible',
    });
    expect(context.cache.setCache).not.toHaveBeenCalled();
  });

  it('returns no_access on an unexpected status code without caching', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(500, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'no_access',
      message: 'Unable to verify access',
    });
  });

  it('retries a gateway error and succeeds on the retry', async () => {
    vi.useFakeTimers();
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { private: true }));
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(result).toEqual({ allowed: true, visibility: 'private' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('retries a thrown network error and gives up with no_access after the final attempt', async () => {
    vi.useFakeTimers();
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(result).toEqual({
      allowed: false,
      reason: 'no_access',
      message: 'Unable to verify GitHub access. Please try again.',
    });
    vi.useRealTimers();
  });

  it('does not retry a non-retriable error thrown by fetch', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockRejectedValueOnce(new Error('boom'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'no_access',
      message: 'Unable to verify GitHub access. Please try again.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('opens the circuit breaker after repeated rate-limit denials and short-circuits further checks', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => jsonResponse(429, {}, { 'Retry-After': '5' }));
    vi.stubGlobal('fetch', fetchMock);

    // The public check itself 429s every time — three denials trip the breaker.
    for (let i = 0; i < 3; i++) {
      const result = await verifyGitHubRepositoryAccess(
        context,
        connectionOf('token', 'repo'),
        userId,
        repository.id,
        { skipCache: true },
      );
      expect(result).toMatchObject({ allowed: false, reason: 'rate_limited' });
    }

    fetchMock.mockClear();
    const openResult = await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
      { skipCache: true },
    );

    expect(openResult).toMatchObject({
      allowed: false,
      reason: 'rate_limited',
      message: expect.stringContaining('Access check temporarily unavailable'),
    });
    // The circuit is open, so no network call happens at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent checks for the same user and repository', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );
    const second = verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    resolveFetch(jsonResponse(200, { private: false }));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    // Only a single public-repo check ran for the two concurrent callers.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('logs a sampled successful access when the sample roll succeeds', async () => {
    const userId = uniqueUserId();
    const repository = await factories.repository.create();
    const context = createContext();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { private: false }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await verifyGitHubRepositoryAccess(
      context,
      connectionOf('token', 'repo'),
      userId,
      repository.id,
    );

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"res":"allowed"'));
  });

  it('skips the sampled log for a routine denial when the sample roll fails', async () => {
    const userId = uniqueUserId();
    const context = createContext();
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await verifyGitHubRepositoryAccess(context, connectionOf('token', 'repo'), userId, 999_999_998);

    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('invalidateGitHubAccessCache', () => {
  it('deletes a single user+repository cache entry when repositoryId is given', async () => {
    const context = createContext();
    context.cache.store.set('github-access:7:100', { result: { allowed: true } });
    context.cache.store.set('github-access:7:200', { result: { allowed: true } });

    await invalidateGitHubAccessCache(context, 7, 100);

    expect(context.cache.store.has('github-access:7:100')).toBe(false);
    expect(context.cache.store.has('github-access:7:200')).toBe(true);
  });

  it('deletes every cache entry for a user when repositoryId is omitted', async () => {
    const context = createContext();
    context.cache.store.set('github-access:7:100', { result: { allowed: true } });
    context.cache.store.set('github-access:7:200', { result: { allowed: true } });
    context.cache.store.set('github-access:8:100', { result: { allowed: true } });

    await invalidateGitHubAccessCache(context, 7);

    expect(context.cache.store.has('github-access:7:100')).toBe(false);
    expect(context.cache.store.has('github-access:7:200')).toBe(false);
    expect(context.cache.store.has('github-access:8:100')).toBe(true);
  });
});

describe('invalidateAllAccessCacheForRepo', () => {
  it('deletes every cached entry for a repository across users', async () => {
    const context = createContext();
    context.cache.store.set('github-access:7:100', { result: { allowed: true } });
    context.cache.store.set('github-access:8:100', { result: { allowed: true } });
    context.cache.store.set('github-access:8:200', { result: { allowed: true } });

    await invalidateAllAccessCacheForRepo(context, 100);

    expect(context.cache.store.has('github-access:7:100')).toBe(false);
    expect(context.cache.store.has('github-access:8:100')).toBe(false);
    expect(context.cache.store.has('github-access:8:200')).toBe(true);
  });
});

describe('markGitHubTokenInvalid', () => {
  it('marks the user connection invalid', async () => {
    const user = await factories.user.create();
    await factories.oauthConnection.create({ userId: user.id });
    const context = createContext();

    await markGitHubTokenInvalid(context, user.id);

    const [connection] = await testDatabase.db
      .select()
      .from(oauthConnection)
      .where(eq(oauthConnection.userId, user.id));
    expect(connection.status).toBe('invalid');
  });

  it('swallows database errors instead of throwing', async () => {
    const context = createContext({
      db: {
        update: () => {
          throw new Error('db unavailable');
        },
      } as unknown as Database,
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(markGitHubTokenInvalid(context, 1)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('markGitHubTokensInvalidByProviderUserId', () => {
  it('marks every connection matching the GitHub provider user id and returns their internal user ids', async () => {
    const user = await factories.user.create();
    await factories.oauthConnection.create({ userId: user.id, providerUserId: '55555' });
    const context = createContext();

    const affected = await markGitHubTokensInvalidByProviderUserId(context, 55555);

    expect(affected).toEqual([user.id]);
    const [connection] = await testDatabase.db
      .select()
      .from(oauthConnection)
      .where(eq(oauthConnection.userId, user.id));
    expect(connection.status).toBe('invalid');
  });

  it('returns an empty array when no connection matches', async () => {
    const context = createContext();

    const affected = await markGitHubTokensInvalidByProviderUserId(context, 999_999);

    expect(affected).toEqual([]);
  });

  it('returns an empty array and swallows database errors', async () => {
    const context = createContext({
      db: {
        update: () => {
          throw new Error('db unavailable');
        },
      } as unknown as Database,
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const affected = await markGitHubTokensInvalidByProviderUserId(context, 1);

    expect(affected).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });
});
