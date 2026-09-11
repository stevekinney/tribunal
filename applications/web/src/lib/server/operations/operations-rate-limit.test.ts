import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpHealthProbeRateLimit, mcpSlidingWindowStore } from '$lib/server/oauth/configuration';
import {
  enforceOperationsRateLimit,
  resetOperationsRateLimiterForTests,
} from './operations-rate-limit';

/**
 * TRI-52: the authenticated operational endpoints are rate-limited on every
 * request through the library's generic SlidingWindowRateLimiter over the real
 * in-memory store (no REDIS_URL in tests). Distinct client addresses per test
 * isolate each assertion in the shared store.
 */

afterEach(() => {
  vi.restoreAllMocks();
  resetOperationsRateLimiterForTests();
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

  it('fails open when the store stalls without rejecting (deadline, TRI-52)', async () => {
    vi.useFakeTimers();
    try {
      const storeSpy = vi
        .spyOn(mcpSlidingWindowStore, 'consume')
        // An established-but-stalled Redis connection: the command never settles.
        .mockReturnValueOnce(new Promise(() => {}));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const resultPromise = enforceOperationsRateLimit('203.0.113.4');
      await vi.advanceTimersByTimeAsync(2_001);

      expect(await resultPromise).toBeNull();
      expect(storeSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds a concurrent burst during a stall to one command (TRI-52)', async () => {
    vi.useFakeTimers();
    try {
      const storeSpy = vi
        .spyOn(mcpSlidingWindowStore, 'consume')
        .mockReturnValue(new Promise(() => {})); // every command stalls
      vi.spyOn(console, 'error').mockImplementation(() => {});

      // Ten concurrent requests arrive within the first (pre-timeout) window.
      const inFlight = Array.from({ length: 10 }, () => enforceOperationsRateLimit('203.0.113.5'));
      await vi.advanceTimersByTimeAsync(2_001);
      for (const result of await Promise.all(inFlight)) expect(result).toBeNull();

      // Only the first issued a command; the other nine failed open immediately.
      expect(storeSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-engages after a stalled command is abandoned at its deadline (TRI-52)', async () => {
    vi.useFakeTimers();
    try {
      const storeSpy = vi
        .spyOn(mcpSlidingWindowStore, 'consume')
        .mockReturnValue(new Promise(() => {})); // stays stalled
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const first = enforceOperationsRateLimit('203.0.113.6');
      await vi.advanceTimersByTimeAsync(2_001);
      expect(await first).toBeNull(); // timed out → guard abandoned

      // The next window re-engages: one more command, not suppressed forever
      // (bounding a sustained stall to one command per window, not one per request).
      const second = enforceOperationsRateLimit('203.0.113.6');
      await vi.advanceTimersByTimeAsync(2_001); // its own command also stalls out
      expect(await second).toBeNull();
      expect(storeSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
