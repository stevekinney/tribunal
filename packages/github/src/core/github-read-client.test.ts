import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CacheOperations } from '../context.js';
import type { CachePolicy } from './cache-policy.js';
import type { CachedEnvelope } from './cached-envelope.js';
import {
  cachedRead,
  type CachedReadFetchFunction,
  type CachedReadFetchResult,
} from './github-read-client.js';

// ============================================================================
// Test helpers
// ============================================================================

function createMockCache(): CacheOperations {
  return {
    getCached: vi.fn().mockResolvedValue(null),
    setCache: vi.fn().mockResolvedValue(true),
    setCacheIndefinitely: vi.fn().mockResolvedValue(true),
    deleteCache: vi.fn().mockResolvedValue(true),
    deleteCacheByPattern: vi.fn().mockResolvedValue(0),
    resetCacheClient: vi.fn(),
  };
}

function createTestPolicy(overrides?: Partial<CachePolicy>): CachePolicy {
  return {
    operationId: 'test-operation',
    keyFactory: (...args: any[]) => `test:${args.join(':')}`,
    ttlSeconds: 60,
    supportsEtag: true,
    ...overrides,
  };
}

type TestData = { items: string[] };

function createFreshFetchFunction(
  data: TestData = { items: ['a'] },
  etag?: string,
): CachedReadFetchFunction<TestData> {
  return vi.fn().mockResolvedValue({ data, etag });
}

function createConditionalFetchFunction(): CachedReadFetchFunction<TestData> {
  return vi.fn().mockImplementation((etag?: string) => {
    if (etag) {
      return Promise.resolve({ notModified: true } as CachedReadFetchResult<TestData>);
    }
    return Promise.resolve({ data: { items: ['fresh'] }, etag: '"new-etag"' });
  });
}

function buildStoredEnvelope(
  overrides?: Partial<CachedEnvelope<TestData>>,
): CachedEnvelope<TestData> {
  return {
    value: { items: ['cached'] },
    etag: '"cached-etag"',
    fetchedAt: Date.now() - 30_000,
    expiresAt: Date.now() + 30_000, // Not expired
    source: 'api',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('cachedRead', () => {
  let cache: CacheOperations;
  let policy: CachePolicy;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = createMockCache();
    policy = createTestPolicy();
  });

  describe('cache miss', () => {
    it('calls the fetch function and returns fresh data', async () => {
      const fetchFunction = createFreshFetchFunction({ items: ['fresh'] }, '"etag-1"');

      const result = await cachedRead(cache, policy, fetchFunction, ['arg1', 'arg2']);

      expect(result.value).toEqual({ items: ['fresh'] });
      expect(result.source).toBe('api');
      expect(fetchFunction).toHaveBeenCalledOnce();
      expect(fetchFunction).toHaveBeenCalledWith();
    });

    it('stores the result in cache after a miss with extended Redis TTL for eTag-capable policies', async () => {
      const fetchFunction = createFreshFetchFunction({ items: ['fresh'] }, '"etag-1"');

      await cachedRead(cache, policy, fetchFunction, ['arg1']);

      expect(cache.setCache).toHaveBeenCalledOnce();
      const [cacheKey, storedEnvelope, ttl] = vi.mocked(cache.setCache).mock.calls[0];
      expect(cacheKey).toBe('test:arg1');
      // Redis TTL is 2x the policy TTL so stale envelopes survive for eTag conditional revalidation
      expect(ttl).toBe(120);
      // Verify the stored envelope (object, not serialized — setCache handles JSON.stringify)
      const envelope = storedEnvelope as CachedEnvelope<TestData>;
      expect(envelope.value).toEqual({ items: ['fresh'] });
      expect(envelope.etag).toBe('"etag-1"');
      expect(envelope.source).toBe('api');
    });

    it('stores with unextended Redis TTL when policy does not support eTags', async () => {
      policy = createTestPolicy({ supportsEtag: false });
      const fetchFunction = createFreshFetchFunction({ items: ['fresh'] });

      await cachedRead(cache, policy, fetchFunction, ['arg1']);

      expect(cache.setCache).toHaveBeenCalledOnce();
      const [, , ttl] = vi.mocked(cache.setCache).mock.calls[0];
      // No eTag support means no stale-while-revalidate window needed
      expect(ttl).toBe(60);
    });
  });

  describe('cache hit (fresh)', () => {
    it('returns cached value without calling fetch function', async () => {
      const envelope = buildStoredEnvelope();
      vi.mocked(cache.getCached).mockResolvedValue(envelope);

      const fetchFunction = createFreshFetchFunction();

      const result = await cachedRead(cache, policy, fetchFunction, ['arg1']);

      expect(result.value).toEqual({ items: ['cached'] });
      expect(result.source).toBe('cache');
      expect(fetchFunction).not.toHaveBeenCalled();
    });
  });

  describe('eTag conditional request (304)', () => {
    it('returns cached value with source "conditional" on 304', async () => {
      // Expired envelope with eTag
      const envelope = buildStoredEnvelope({
        expiresAt: Date.now() - 1000, // Expired
        etag: '"old-etag"',
      });
      vi.mocked(cache.getCached).mockResolvedValue(envelope);

      const fetchFunction = createConditionalFetchFunction();

      const result = await cachedRead(cache, policy, fetchFunction, ['arg1']);

      expect(result.value).toEqual({ items: ['cached'] });
      expect(result.source).toBe('conditional');
      expect(fetchFunction).toHaveBeenCalledWith('"old-etag"');
    });
  });

  describe('eTag conditional request (200 — stale data)', () => {
    it('returns fresh data when conditional request returns 200', async () => {
      // Expired envelope with eTag
      const envelope = buildStoredEnvelope({
        expiresAt: Date.now() - 1000,
        etag: '"old-etag"',
      });
      vi.mocked(cache.getCached).mockResolvedValue(envelope);

      const fetchFunction = vi.fn().mockResolvedValue({
        data: { items: ['updated'] },
        etag: '"new-etag"',
      });

      const result = await cachedRead(cache, policy, fetchFunction, ['arg1']);

      expect(result.value).toEqual({ items: ['updated'] });
      expect(result.source).toBe('api');
    });
  });

  describe('expired cache without eTag', () => {
    it('fetches fresh data when expired and no eTag', async () => {
      const envelope = buildStoredEnvelope({
        expiresAt: Date.now() - 1000,
        etag: undefined,
      });
      vi.mocked(cache.getCached).mockResolvedValue(envelope);

      const fetchFunction = createFreshFetchFunction({ items: ['fresh'] });

      const result = await cachedRead(cache, policy, fetchFunction, ['arg1']);

      expect(result.value).toEqual({ items: ['fresh'] });
      expect(result.source).toBe('api');
      // Should be called without an eTag argument
      expect(fetchFunction).toHaveBeenCalledWith();
    });
  });

  describe('expired cache with eTag but supportsEtag=false', () => {
    it('fetches fresh data without conditional request', async () => {
      policy = createTestPolicy({ supportsEtag: false });
      const envelope = buildStoredEnvelope({
        expiresAt: Date.now() - 1000,
        etag: '"some-etag"',
      });
      vi.mocked(cache.getCached).mockResolvedValue(envelope);

      const fetchFunction = createFreshFetchFunction({ items: ['fresh'] });

      const result = await cachedRead(cache, policy, fetchFunction, ['arg1']);

      expect(result.value).toEqual({ items: ['fresh'] });
      expect(result.source).toBe('api');
      expect(fetchFunction).toHaveBeenCalledWith();
    });
  });

  describe('Redis error (fail-open)', () => {
    it('calls GitHub directly when Redis getCached throws', async () => {
      vi.mocked(cache.getCached).mockRejectedValue(new Error('Redis connection lost'));

      const fetchFunction = createFreshFetchFunction({ items: ['from-api'] });

      const result = await cachedRead(cache, policy, fetchFunction, ['arg1']);

      expect(result.value).toEqual({ items: ['from-api'] });
      expect(result.source).toBe('api');
    });

    it('still succeeds when Redis setCache throws during store', async () => {
      vi.mocked(cache.setCache).mockRejectedValue(new Error('Redis write failed'));

      const fetchFunction = createFreshFetchFunction({ items: ['from-api'] });

      const result = await cachedRead(cache, policy, fetchFunction, ['arg1']);

      expect(result.value).toEqual({ items: ['from-api'] });
      expect(result.source).toBe('api');
    });
  });

  describe('GitHub error (propagate)', () => {
    it('propagates GitHub API errors', async () => {
      const fetchFunction = vi.fn().mockRejectedValue(new Error('GitHub 500'));

      await expect(cachedRead(cache, policy, fetchFunction, ['arg1'])).rejects.toThrow(
        'GitHub 500',
      );
    });

    it('propagates GitHub errors even with expired eTag cache', async () => {
      const envelope = buildStoredEnvelope({
        expiresAt: Date.now() - 1000,
        etag: '"old-etag"',
      });
      vi.mocked(cache.getCached).mockResolvedValue(envelope);

      const fetchFunction = vi.fn().mockRejectedValue(new Error('GitHub rate limited'));

      await expect(cachedRead(cache, policy, fetchFunction, ['arg1'])).rejects.toThrow(
        'GitHub rate limited',
      );
    });
  });

  describe('bypass mode', () => {
    it('skips cache and calls GitHub directly', async () => {
      // Put a valid cache entry
      const envelope = buildStoredEnvelope();
      vi.mocked(cache.getCached).mockResolvedValue(envelope);

      const fetchFunction = createFreshFetchFunction({ items: ['bypassed'] });

      const result = await cachedRead(cache, policy, fetchFunction, ['arg1'], { bypass: true });

      expect(result.value).toEqual({ items: ['bypassed'] });
      expect(result.source).toBe('api');
      // getCached should not have been called
      expect(cache.getCached).not.toHaveBeenCalled();
    });

    it('still stores the result in cache after bypass', async () => {
      const fetchFunction = createFreshFetchFunction({ items: ['bypassed'] });

      await cachedRead(cache, policy, fetchFunction, ['arg1'], { bypass: true });

      expect(cache.setCache).toHaveBeenCalled();
    });
  });

  describe('cache key construction', () => {
    it('passes keyArgs to policy.keyFactory', async () => {
      const keyFactory = vi.fn().mockReturnValue('custom:key');
      policy = createTestPolicy({ keyFactory });

      const fetchFunction = createFreshFetchFunction();

      await cachedRead(cache, policy, fetchFunction, ['owner', 'repo', 42]);

      expect(keyFactory).toHaveBeenCalledWith('owner', 'repo', 42);
      expect(cache.getCached).toHaveBeenCalledWith('custom:key');
    });
  });

  describe('malformed cache entries', () => {
    it('treats a non-envelope object as a cache miss', async () => {
      // getCached returns something that is not a valid envelope (missing required fields)
      vi.mocked(cache.getCached).mockResolvedValue({ unrelated: 'data' });

      const fetchFunction = createFreshFetchFunction({ items: ['fresh'] });

      const result = await cachedRead(cache, policy, fetchFunction, ['arg1']);

      expect(result.value).toEqual({ items: ['fresh'] });
      expect(result.source).toBe('api');
      expect(fetchFunction).toHaveBeenCalledOnce();
    });
  });

  describe('unexpected 304', () => {
    it('throws when fetchFunction returns 304 without a cached eTag', async () => {
      const fetchFunction = vi.fn().mockResolvedValue({ notModified: true });

      await expect(cachedRead(cache, policy, fetchFunction, ['arg1'])).rejects.toThrow(
        'Unexpected 304',
      );
    });
  });
});
