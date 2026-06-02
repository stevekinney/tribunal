import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GithubServiceContext } from '../context.js';

import {
  getRateLimitState,
  updateRateLimitFromHeaders,
  checkRateLimitState,
  clearRateLimitState,
  decrementRateLimitRemaining,
  isSecondaryRateLimit,
  type RateLimitState,
} from './rate-limits.js';

function createMockContext(overrides?: Partial<GithubServiceContext>): GithubServiceContext {
  return {
    db: {} as any,
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
    getGithubApplication: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

describe('rate-limits', () => {
  const installationId = 12345;
  let context: GithubServiceContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockContext();
  });

  describe('getRateLimitState', () => {
    it('returns cached state when available', async () => {
      expect.assertions(1);
      const state: RateLimitState = {
        remaining: 4500,
        limit: 5000,
        resetAt: Math.floor(Date.now() / 1000) + 3600,
        lastUpdated: Date.now(),
        isSecondaryLimit: false,
      };
      vi.mocked(context.cache.getCached).mockResolvedValue(state);

      const result = await getRateLimitState(context, installationId);

      expect(result).toEqual(state);
    });

    it('returns null when no cached state', async () => {
      expect.assertions(1);
      vi.mocked(context.cache.getCached).mockResolvedValue(null);

      const result = await getRateLimitState(context, installationId);

      expect(result).toBeNull();
    });

    it('fails open when Redis throws', async () => {
      expect.assertions(1);
      vi.mocked(context.cache.getCached).mockRejectedValue(new Error('Redis connection failed'));

      const result = await getRateLimitState(context, installationId);

      expect(result).toBeNull();
    });
  });

  describe('updateRateLimitFromHeaders', () => {
    it('stores rate limit state from headers', async () => {
      expect.assertions(2);
      vi.mocked(context.cache.setCache).mockResolvedValue(true);

      const headers = {
        'x-ratelimit-remaining': '4500',
        'x-ratelimit-limit': '5000',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
      };

      await updateRateLimitFromHeaders(context, installationId, headers);

      expect(context.cache.setCache).toHaveBeenCalledTimes(1);
      const [, state] = vi.mocked(context.cache.setCache).mock.calls[0] as [
        string,
        RateLimitState,
        number,
      ];
      expect(state.remaining).toBe(4500);
    });

    it('stores rate limit state from headers with original casing', async () => {
      expect.assertions(3);
      vi.mocked(context.cache.setCache).mockResolvedValue(true);

      const headers = {
        'X-RateLimit-Remaining': '123',
        'X-RateLimit-Limit': '5000',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
      };

      await updateRateLimitFromHeaders(context, installationId, headers);

      expect(context.cache.setCache).toHaveBeenCalledTimes(1);
      const [, state] = vi.mocked(context.cache.setCache).mock.calls[0] as [
        string,
        RateLimitState,
        number,
      ];
      expect(state.remaining).toBe(123);
      expect(state.limit).toBe(5000);
    });

    it('handles secondary rate limit with retry-after', async () => {
      expect.assertions(3);
      vi.mocked(context.cache.setCache).mockResolvedValue(true);

      const headers = {
        'retry-after': '60',
      };

      await updateRateLimitFromHeaders(context, installationId, headers, true);

      expect(context.cache.setCache).toHaveBeenCalledTimes(1);
      const [, state] = vi.mocked(context.cache.setCache).mock.calls[0] as [
        string,
        RateLimitState,
        number,
      ];
      expect(state.remaining).toBe(0);
      expect(state.isSecondaryLimit).toBe(true);
    });

    it('does not store when required headers missing', async () => {
      expect.assertions(1);

      const headers = {
        'x-ratelimit-limit': '5000',
        // Missing remaining and reset
      };

      await updateRateLimitFromHeaders(context, installationId, headers);

      expect(context.cache.setCache).not.toHaveBeenCalled();
    });

    it('fails open when Redis throws', async () => {
      expect.assertions(1);
      vi.mocked(context.cache.setCache).mockRejectedValue(new Error('Redis connection failed'));

      const headers = {
        'x-ratelimit-remaining': '4500',
        'x-ratelimit-limit': '5000',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
      };

      // Should not throw
      await expect(
        updateRateLimitFromHeaders(context, installationId, headers),
      ).resolves.toBeUndefined();
    });
  });

  describe('checkRateLimitState', () => {
    it('returns not limited when no cached state', async () => {
      expect.assertions(1);
      vi.mocked(context.cache.getCached).mockResolvedValue(null);

      const result = await checkRateLimitState(context, installationId);

      expect(result).toEqual({ limited: false });
    });

    it('returns not limited when limit has reset', async () => {
      expect.assertions(1);
      const state: RateLimitState = {
        remaining: 0,
        limit: 5000,
        resetAt: Math.floor(Date.now() / 1000) - 60, // Past reset time
        lastUpdated: Date.now(),
        isSecondaryLimit: false,
      };
      vi.mocked(context.cache.getCached).mockResolvedValue(state);

      const result = await checkRateLimitState(context, installationId);

      expect(result).toEqual({ limited: false });
    });

    it('returns not limited when remaining > 0', async () => {
      expect.assertions(1);
      const state: RateLimitState = {
        remaining: 100,
        limit: 5000,
        resetAt: Math.floor(Date.now() / 1000) + 3600,
        lastUpdated: Date.now(),
        isSecondaryLimit: false,
      };
      vi.mocked(context.cache.getCached).mockResolvedValue(state);

      const result = await checkRateLimitState(context, installationId);

      expect(result).toEqual({ limited: false });
    });

    it('returns limited when remaining is 0 and not reset', async () => {
      expect.assertions(4);
      const futureResetAt = Math.floor(Date.now() / 1000) + 120;
      const state: RateLimitState = {
        remaining: 0,
        limit: 5000,
        resetAt: futureResetAt,
        lastUpdated: Date.now(),
        isSecondaryLimit: false,
      };
      vi.mocked(context.cache.getCached).mockResolvedValue(state);

      const result = await checkRateLimitState(context, installationId);

      expect(result.limited).toBe(true);
      if (result.limited) {
        expect(result.retryAfterSeconds).toBeGreaterThan(100);
        expect(result.retryAfterSeconds).toBeLessThanOrEqual(120);
        expect(result.isSecondary).toBe(false);
      }
    });

    it('includes isSecondary flag for secondary rate limits', async () => {
      expect.assertions(2);
      const state: RateLimitState = {
        remaining: 0,
        limit: 5000,
        resetAt: Math.floor(Date.now() / 1000) + 60,
        lastUpdated: Date.now(),
        isSecondaryLimit: true,
      };
      vi.mocked(context.cache.getCached).mockResolvedValue(state);

      const result = await checkRateLimitState(context, installationId);

      expect(result.limited).toBe(true);
      if (result.limited) {
        expect(result.isSecondary).toBe(true);
      }
    });

    it('fails open when Redis throws', async () => {
      expect.assertions(1);
      vi.mocked(context.cache.getCached).mockRejectedValue(new Error('Redis connection failed'));

      const result = await checkRateLimitState(context, installationId);

      expect(result).toEqual({ limited: false });
    });
  });

  describe('clearRateLimitState', () => {
    it('deletes cached state', async () => {
      expect.assertions(1);
      vi.mocked(context.cache.deleteCache).mockResolvedValue(true);

      await clearRateLimitState(context, installationId);

      expect(context.cache.deleteCache).toHaveBeenCalledWith(
        `github-ratelimit:installation:${installationId}`,
      );
    });

    it('fails open when Redis throws', async () => {
      expect.assertions(1);
      vi.mocked(context.cache.deleteCache).mockRejectedValue(new Error('Redis connection failed'));

      // Should not throw
      await expect(clearRateLimitState(context, installationId)).resolves.toBeUndefined();
    });
  });

  describe('decrementRateLimitRemaining', () => {
    it('decrements remaining count', async () => {
      expect.assertions(2);
      const state: RateLimitState = {
        remaining: 100,
        limit: 5000,
        resetAt: Math.floor(Date.now() / 1000) + 3600,
        lastUpdated: Date.now(),
        isSecondaryLimit: false,
      };
      vi.mocked(context.cache.getCached).mockResolvedValue(state);
      vi.mocked(context.cache.setCache).mockResolvedValue(true);

      await decrementRateLimitRemaining(context, installationId);

      expect(context.cache.setCache).toHaveBeenCalledTimes(1);
      const [, updatedState] = vi.mocked(context.cache.setCache).mock.calls[0] as [
        string,
        RateLimitState,
        number,
      ];
      expect(updatedState.remaining).toBe(99);
    });

    it('does not decrement when already at 0', async () => {
      expect.assertions(1);
      const state: RateLimitState = {
        remaining: 0,
        limit: 5000,
        resetAt: Math.floor(Date.now() / 1000) + 3600,
        lastUpdated: Date.now(),
        isSecondaryLimit: false,
      };
      vi.mocked(context.cache.getCached).mockResolvedValue(state);

      await decrementRateLimitRemaining(context, installationId);

      expect(context.cache.setCache).not.toHaveBeenCalled();
    });

    it('does nothing when no cached state', async () => {
      expect.assertions(1);
      vi.mocked(context.cache.getCached).mockResolvedValue(null);

      await decrementRateLimitRemaining(context, installationId);

      expect(context.cache.setCache).not.toHaveBeenCalled();
    });
  });

  describe('isSecondaryRateLimit', () => {
    it('returns true for 429 status', () => {
      expect.assertions(1);
      expect(isSecondaryRateLimit(429, {})).toBe(true);
    });

    it('returns true for 403 with retry-after header', () => {
      expect.assertions(1);
      expect(isSecondaryRateLimit(403, { 'retry-after': '60' })).toBe(true);
    });

    it('returns false for 403 without retry-after header', () => {
      expect.assertions(1);
      expect(isSecondaryRateLimit(403, {})).toBe(false);
    });

    it('returns false for other status codes', () => {
      expect.assertions(2);
      expect(isSecondaryRateLimit(200, {})).toBe(false);
      expect(isSecondaryRateLimit(500, {})).toBe(false);
    });
  });
});
