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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('operations rate limiter timed out')),
        OPERATIONS_LIMITER_TIMEOUT_MS,
      );
      timer.unref?.();
    });
    const result = await Promise.race([
      operationsLimiter.consume({
        key: `rate_limit:${mcpRateLimitKeyNamespace}:operations:${clientAddress}`,
        maximumRequests: mcpHealthProbeRateLimit.maximumRequests,
        windowSeconds: mcpHealthProbeRateLimit.windowSeconds,
        atomicStore: mcpSlidingWindowStore,
      }),
      deadline,
    ]);
    if (result.allowed) return null;
    return Response.json(
      { error: 'rate_limited', error_description: 'Too many operational requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(result.retryAfterSeconds), 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    console.error('Operations rate limiter error (serving anyway):', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
