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

/**
 * The single store command allowed in flight at a time. While one is pending,
 * every other request fails open without issuing its own — so neither a
 * concurrent burst nor a sustained stall can let unauthenticated pre-auth traffic
 * queue one uncancellable Redis command per request and exhaust the connection
 * queue or memory (TRI-52). Under healthy Redis commands resolve in well under a
 * millisecond, so the guard is almost never contended and sequential requests each
 * consume normally; it engages only when commands are slow — exactly when bounding
 * them matters.
 *
 * The guard is held until the command actually **settles**, not abandoned at the
 * request deadline: a request that exceeds the deadline fails open and returns,
 * but the command stays in flight and keeps the guard closed, so a sustained
 * outage holds exactly one pending command rather than accumulating one every
 * window. The command is not cancellable, but it does settle when the socket
 * eventually errors or Redis recovers, at which point the guard clears and the
 * limiter re-engages. Failing open meanwhile is acceptable: the limiter is
 * defense-in-depth and the bearer token is the guard. (This differs from the
 * readiness cache, which re-probes per window because its job is to report
 * current readiness; the limiter has no such need to keep probing.)
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
  // Clear the guard only when the command actually settles (resolve or reject),
  // never at the request deadline. A no-op catch keeps a late rejection from
  // surfacing as unhandled.
  void consumePromise
    .finally(() => {
      if (inFlightConsume === consumePromise) inFlightConsume = null;
    })
    .catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('operations rate limiter timed out')),
        OPERATIONS_LIMITER_TIMEOUT_MS,
      );
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
    // Fail open on both a deadline timeout and a store error. On a timeout the
    // command stays in flight and keeps the guard closed (one pending command,
    // not one per window); the guard clears via the `.finally` above when it
    // finally settles.
    console.error('Operations rate limiter error (serving anyway):', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
