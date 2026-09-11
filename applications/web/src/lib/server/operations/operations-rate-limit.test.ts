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

  it('opens a breaker after a stall so later requests do not queue more commands (TRI-52)', async () => {
    vi.useFakeTimers();
    try {
      const storeSpy = vi
        .spyOn(mcpSlidingWindowStore, 'consume')
        .mockReturnValue(new Promise(() => {})); // every command stalls
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const first = enforceOperationsRateLimit('203.0.113.5');
      await vi.advanceTimersByTimeAsync(2_001);
      expect(await first).toBeNull(); // timed out → breaker open
      const callsSoFar = storeSpy.mock.calls.length;

      // With the breaker open, the next request fails open immediately without
      // issuing another (uncancellable) Redis command.
      expect(await enforceOperationsRateLimit('203.0.113.5')).toBeNull();
      expect(storeSpy.mock.calls.length).toBe(callsSoFar);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the breaker once the stalled command settles (TRI-52)', async () => {
    vi.useFakeTimers();
    try {
      let rejectStalled: (error: unknown) => void = () => {};
      const storeSpy = vi
        .spyOn(mcpSlidingWindowStore, 'consume')
        .mockReturnValueOnce(new Promise((_resolve, reject) => (rejectStalled = reject)))
        .mockRejectedValue(new Error('redis down'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const first = enforceOperationsRateLimit('203.0.113.6');
      await vi.advanceTimersByTimeAsync(2_001);
      expect(await first).toBeNull(); // breaker open
      const callsWhileOpen = storeSpy.mock.calls.length;

      // The stalled command finally settles → breaker closes.
      rejectStalled(new Error('redis settled late'));
      await vi.advanceTimersByTimeAsync(1);

      // Breaker closed: the next request consults the store again (fails open).
      expect(await enforceOperationsRateLimit('203.0.113.6')).toBeNull();
      expect(storeSpy.mock.calls.length).toBe(callsWhileOpen + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});
