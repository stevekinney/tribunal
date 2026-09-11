import { SlidingWindowRateLimiter } from '@lostgradient/mcp/rate-limit';
import {
  mcpHealthProbeRateLimit,
  mcpRateLimitKeyNamespace,
  mcpSlidingWindowStore,
} from '$lib/server/oauth/configuration';

/**
 * Rate-limits the authenticated operational endpoints (`/health/ready`,
 * `/metrics`) through the library's generic `SlidingWindowRateLimiter` over the
 * shared sliding-window store (TRI-52), reusing the health-probe budget.
 */
const operationsLimiter = new SlidingWindowRateLimiter();

/**
 * Deadline on the rate-limit store call. The production Redis client bounds
 * connection establishment but sets no command timeout, so an established-but-
 * stalled connection would make `consume()` hang before the catch below ever runs
 * — hanging /metrics and /health/ready before auth and defeating fail-open
 * (TRI-52). Racing the call against this deadline routes a stall into the same
 * fail-open path as any other limiter error.
 */
const OPERATIONS_LIMITER_TIMEOUT_MS = 2_000;

/** Distinguishes a deadline timeout from a store error thrown by `consume()`. */
const LIMITER_TIMEOUT = Symbol('operations-limiter-timeout');

/**
 * The one command that has been **classified as stalled** — it exceeded its
 * request deadline and is still pending. While set, new requests fail open
 * without issuing their own command, so a sustained Redis stall cannot let
 * unauthenticated pre-auth traffic queue one uncancellable command per request
 * and exhaust the connection queue or memory (TRI-52).
 *
 * Crucially, this engages ONLY after a command is classified stalled, not while
 * any command is merely in flight: under healthy Redis (sub-millisecond commands)
 * it is never set, so every request — including concurrent ones — issues its own
 * `consume()` and is counted. That is required by OPS-002, which bounds a
 * bearer-guess loop only if each request spends budget; suppressing concurrent
 * healthy requests (an earlier revision did) would let a concurrent batch count
 * as one. The unavoidable cost is that the first window of a stall issues one
 * command per request before the first is classified stalled — bounded (one
 * window's requests, and only during an outage), and the price of honoring
 * per-request counting against a store-backed limiter.
 *
 * Held until the stalled command actually settles (not abandoned at the
 * deadline), so a sustained outage holds exactly one pending command rather than
 * accumulating one per window; it settles when the socket errors or Redis
 * recovers, clearing the breaker so the limiter re-engages. Failing open
 * meanwhile is acceptable — the limiter is defense-in-depth; the bearer token is
 * the guard.
 */
let stalledConsume: Promise<unknown> | null = null;

/** Test-only: resets the breaker between cases. */
export function resetOperationsRateLimiterForTests(): void {
  stalledConsume = null;
}

/**
 * Consumes the operational budget for `clientAddress` and returns a `429` when it
 * is exhausted, or `null` to proceed.
 *
 * Called on **every** request, before authentication (OPS-002): a wrong-bearer
 * guess must still spend budget, or a guess loop against a fast-rejecting auth
 * check is effectively free. `/health/ready` and `/metrics` share one per-client
 * `operations` budget, so the bound holds across both.
 *
 * Fails **open** on a limiter error, like the public `/health` gate and for the
 * same reason: these are observability endpoints, and a rate-limiter (Redis)
 * outage must not blind an operator during the very incident they need `/metrics`
 * (in-memory, Redis-independent) and `/health/ready` to diagnose. The bearer
 * token remains the primary guard; the rate limit is defense-in-depth whose only
 * lapse is a window in which Redis — hence the store — is already down.
 */
export async function enforceOperationsRateLimit(clientAddress: string): Promise<Response | null> {
  // Suppress new commands only while a prior command is classified stalled — not
  // while one is merely in flight — so concurrent healthy requests each still
  // consume and are counted (OPS-002).
  if (stalledConsume) return null;

  const consumePromise = operationsLimiter.consume({
    key: `rate_limit:${mcpRateLimitKeyNamespace}:operations:${clientAddress}`,
    maximumRequests: mcpHealthProbeRateLimit.maximumRequests,
    windowSeconds: mcpHealthProbeRateLimit.windowSeconds,
    atomicStore: mcpSlidingWindowStore,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(LIMITER_TIMEOUT), OPERATIONS_LIMITER_TIMEOUT_MS);
      timer.unref?.();
    });
    const result = await Promise.race([consumePromise, deadline]);
    if (result.allowed) return null;
    return Response.json(
      { error: 'rate_limited', error_description: 'Too many operational requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(result.retryAfterSeconds), 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    if (error === LIMITER_TIMEOUT) {
      // Classify this command as stalled and open the breaker until it settles, so
      // subsequent requests fail open without queueing more. A late rejection is
      // swallowed to avoid an unhandled rejection; the guard clears on settle.
      stalledConsume = consumePromise;
      void consumePromise
        .finally(() => {
          if (stalledConsume === consumePromise) stalledConsume = null;
        })
        .catch(() => {});
    }
    console.error('Operations rate limiter error (serving anyway):', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
