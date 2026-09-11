import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpHealthProbeRateLimit, mcpSlidingWindowStore } from '$lib/server/oauth/configuration';
import { enforceHealthProbeRateLimit } from './health-rate-limit';

/**
 * TRI-56 AC3: `/health` is rate-limited through the library's generic
 * SlidingWindowRateLimiter, over the real in-memory store (no REDIS_URL in tests).
 * Distinct client addresses per test isolate each assertion in the shared store.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enforceHealthProbeRateLimit', () => {
  it('allows a probe under the budget (returns null to proceed)', async () => {
    expect(await enforceHealthProbeRateLimit('198.51.100.1')).toBeNull();
  });

  it('returns 429 with a Retry-After once the per-IP budget is exhausted', async () => {
    const clientAddress = '198.51.100.2';
    for (let attempt = 0; attempt < mcpHealthProbeRateLimit.maximumRequests; attempt += 1) {
      expect(await enforceHealthProbeRateLimit(clientAddress)).toBeNull();
    }
    const limited = await enforceHealthProbeRateLimit(clientAddress);
    expect(limited).not.toBeNull();
    expect(limited!.status).toBe(429);
    expect(Number(limited!.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('fails open (serves health) when the limiter store errors, so the Fly gate survives a Redis outage', async () => {
    const storeSpy = vi
      .spyOn(mcpSlidingWindowStore, 'consume')
      .mockRejectedValueOnce(new Error('redis down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await enforceHealthProbeRateLimit('198.51.100.3')).toBeNull();
    expect(storeSpy).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
  });
});
