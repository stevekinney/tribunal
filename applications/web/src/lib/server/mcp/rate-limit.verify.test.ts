import { describe, expect, it } from 'vitest';
import { RequestRateLimiter, createInMemorySlidingWindowStore } from '@lostgradient/mcp/rate-limit';
import { mcpRateLimitConfiguration } from '$lib/server/oauth/configuration';

/**
 * Verifies Tribunal's rate-limit CONFIGURATION through the library's limiter
 * (TRI-56). The sliding-window arithmetic and the Lua are the library's, proven
 * in TRI-103; these tests prove the budgets Tribunal configures — the per-category
 * limits, their independence, the window-derived Retry-After, and that a second
 * instance does not double a shared budget.
 *
 * They run against the library's IN-MEMORY store, not Redis: the vitest
 * environment has no real Redis and no Lua-capable fake, so the Redis-backed
 * behavior (identical interface, the library's Lua) is deferred to TRI-132. The
 * store is constructed fresh per test and time is controlled, so each assertion is
 * deterministic and isolated regardless of worker parallelism.
 */

const CONFIG = mcpRateLimitConfiguration;
const REGISTER_LIMIT = CONFIG.categories.oauth_register.maximumRequests; // 5
const REGISTER_WINDOW_SECONDS = CONFIG.categories.oauth_register.windowSeconds; // 60

/** A limiter over a fresh in-memory store with a controllable clock. */
function makeLimiter(now: { value: number }, store = createInMemorySlidingWindowStore()) {
  return {
    limiter: new RequestRateLimiter(
      CONFIG,
      () => store,
      () => now.value,
    ),
    store,
  };
}

describe('TRI-56 AC2 — the eight categories have independent budgets', () => {
  it('exhausts one category while another still admits', async () => {
    const now = { value: 0 };
    const { limiter } = makeLimiter(now);

    for (let attempt = 0; attempt < REGISTER_LIMIT; attempt += 1) {
      expect((await limiter.consume('oauth_register', '203.0.113.1')).allowed).toBe(true);
    }
    // The next oauth_register is denied — its own budget is spent…
    expect((await limiter.consume('oauth_register', '203.0.113.1')).allowed).toBe(false);
    // …but a different category, same identifier, still admits: budgets are independent.
    expect((await limiter.consume('oauth_authorize', '203.0.113.1')).allowed).toBe(true);
  });
});

describe('TRI-56 AC4 — a denied request carries a window-derived Retry-After', () => {
  it('reports a non-zero Retry-After that tracks the elapsed window', async () => {
    const now = { value: 0 };
    const { limiter } = makeLimiter(now);
    for (let attempt = 0; attempt < REGISTER_LIMIT; attempt += 1) {
      await limiter.consume('oauth_register', '203.0.113.2');
    }

    const deniedImmediately = await limiter.consume('oauth_register', '203.0.113.2');
    expect(deniedImmediately.allowed).toBe(false);
    // Never 0 on a denied request, and no larger than the window.
    expect(deniedImmediately.retryAfterSeconds).toBeGreaterThan(0);
    expect(deniedImmediately.retryAfterSeconds).toBeLessThanOrEqual(REGISTER_WINDOW_SECONDS);

    // Advance most of the window; the reported wait shrinks as the oldest entry ages out.
    now.value = (REGISTER_WINDOW_SECONDS - 5) * 1000;
    const deniedLater = await limiter.consume('oauth_register', '203.0.113.2');
    expect(deniedLater.allowed).toBe(false);
    expect(deniedLater.retryAfterSeconds).toBeGreaterThan(0);
    expect(deniedLater.retryAfterSeconds).toBeLessThan(deniedImmediately.retryAfterSeconds);
  });
});

describe('TRI-56 AC9 — a second instance does not double a shared budget', () => {
  it('two limiters over one store share a single budget', async () => {
    const now = { value: 0 };
    const store = createInMemorySlidingWindowStore();
    // Two independent limiter instances (as two replicas would each construct),
    // both backed by the same store object (as one shared Redis would be).
    const instanceA = new RequestRateLimiter(
      CONFIG,
      () => store,
      () => now.value,
    );
    const instanceB = new RequestRateLimiter(
      CONFIG,
      () => store,
      () => now.value,
    );

    // Instance A spends the whole oauth_register budget…
    for (let attempt = 0; attempt < REGISTER_LIMIT; attempt += 1) {
      expect((await instanceA.consume('oauth_register', '203.0.113.3')).allowed).toBe(true);
    }
    // …and instance B is already at the limit — the budget is not doubled.
    expect((await instanceB.consume('oauth_register', '203.0.113.3')).allowed).toBe(false);
  });
});
