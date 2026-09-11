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

  it('counts every concurrent request under healthy Redis — no suppression (OPS-002)', async () => {
    // The guard engages only after a command is classified stalled, never while
    // one is merely in flight, so concurrent healthy requests each consume and are
    // counted. Suppressing them would let a concurrent bearer-guess batch count as
    // one.
    const storeSpy = vi.spyOn(mcpSlidingWindowStore, 'consume'); // real in-memory store, resolves fast

    const results = await Promise.all(
      Array.from({ length: 5 }, () => enforceOperationsRateLimit('203.0.113.7')),
    );

    for (const result of results) expect(result).toBeNull(); // all under budget
    expect(storeSpy).toHaveBeenCalledTimes(5); // each request issued its own consume
  });

  it('keeps suppressing commands while one stays stalled, then re-engages once it settles (TRI-52)', async () => {
    vi.useFakeTimers();
    try {
      let settleStalled: () => void = () => {};
      const storeSpy = vi
        .spyOn(mcpSlidingWindowStore, 'consume')
        .mockReturnValueOnce(
          new Promise((_resolve, reject) => {
            settleStalled = () => reject(new Error('socket finally errored'));
          }),
        )
        .mockRejectedValue(new Error('redis down'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const first = enforceOperationsRateLimit('203.0.113.6');
      await vi.advanceTimersByTimeAsync(2_001);
      expect(await first).toBeNull(); // timed out, failed open — but the command is still in flight

      // Still suppressed while that command is pending: no new command issued.
      expect(await enforceOperationsRateLimit('203.0.113.6')).toBeNull();
      expect(storeSpy).toHaveBeenCalledTimes(1);

      // Once the stalled command actually settles, the guard clears and the next
      // request re-engages — exactly one pending command across the whole stall.
      settleStalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await enforceOperationsRateLimit('203.0.113.6')).toBeNull();
      expect(storeSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
