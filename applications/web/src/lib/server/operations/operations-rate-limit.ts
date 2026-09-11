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
 * The single store command allowed in flight at a time. While one is pending,
 * every other request fails open without issuing its own — so neither a
 * concurrent burst (before any timeout) nor a sustained stall can let
 * unauthenticated pre-auth traffic queue one uncancellable Redis command per
 * request and exhaust the connection queue or memory (TRI-52). Under healthy
 * Redis commands resolve in well under a millisecond, so the guard is almost
 * never contended and sequential requests each consume normally; it engages only
 * when commands are slow — exactly when bounding them matters. A stalled command
 * is abandoned at its deadline (the guard clears) so the limiter re-engages on
 * recovery, bounding a sustained outage to one command per timeout window rather
 * than one per request. The limiter is defense-in-depth — the bearer token is the
 * guard — so occasionally skipping the limit under contention is acceptable.
 */
let inFlightConsume: Promise<unknown> | null = null;

/** Test-only: resets the in-flight guard between cases. */
export function resetOperationsRateLimiterForTests(): void {
  inFlightConsume = null;
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
  // A store command is already in flight: fail open without issuing another, so a
  // concurrent burst or a stall cannot pile up uncancellable commands.
  if (inFlightConsume) return null;

  const consumePromise = operationsLimiter.consume({
    key: `rate_limit:${mcpRateLimitKeyNamespace}:operations:${clientAddress}`,
    maximumRequests: mcpHealthProbeRateLimit.maximumRequests,
    windowSeconds: mcpHealthProbeRateLimit.windowSeconds,
    atomicStore: mcpSlidingWindowStore,
  });
  inFlightConsume = consumePromise;
  // Clear the guard when the command settles. A no-op catch keeps a late
  // rejection (e.g. after its deadline abandoned it) from surfacing as unhandled.
  void consumePromise
    .finally(() => {
      if (inFlightConsume === consumePromise) inFlightConsume = null;
    })
    .catch(() => {});

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
      // Abandon the stalled command so the limiter re-engages on recovery rather
      // than staying pinned open; the late .finally above won't match once a newer
      // command has claimed the guard, so it cannot clobber it.
      if (inFlightConsume === consumePromise) inFlightConsume = null;
    }
    console.error('Operations rate limiter error (serving anyway):', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
