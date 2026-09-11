import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpHealthProbeRateLimit, mcpSlidingWindowStore } from '$lib/server/oauth/configuration';
import { enforceOperationsRateLimit } from './operations-rate-limit';

/**
 * TRI-52: the authenticated operational endpoints are rate-limited on every
 * request through the library's generic SlidingWindowRateLimiter over the real
 * in-memory store (no REDIS_URL in tests). Distinct client addresses per test
 * isolate each assertion in the shared store.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enforceOperationsRateLimit', () => {
  it('allows a request under the budget (returns null to proceed)', async () => {
    expect(await enforceOperationsRateLimit('203.0.113.1')).toBeNull();
  });

  it('returns 429 with Retry-After and no-store once the per-IP budget is exhausted', async () => {
    const clientAddress = '203.0.113.2';
    for (let attempt = 0; attempt < mcpHealthProbeRateLimit.maximumRequests; attempt += 1) {
      expect(await enforceOperationsRateLimit(clientAddress)).toBeNull();
    }
    const limited = await enforceOperationsRateLimit(clientAddress);
    expect(limited).not.toBeNull();
    expect(limited!.status).toBe(429);
    expect(Number(limited!.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(limited!.headers.get('Cache-Control')).toBe('no-store');
  });

  it('fails open when the limiter store errors, so a Redis outage does not blind /metrics', async () => {
    const storeSpy = vi
      .spyOn(mcpSlidingWindowStore, 'consume')
      .mockRejectedValueOnce(new Error('redis down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await enforceOperationsRateLimit('203.0.113.3')).toBeNull();
    expect(storeSpy).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
  });
});
