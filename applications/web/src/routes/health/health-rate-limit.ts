import { SlidingWindowRateLimiter } from '@lostgradient/mcp/rate-limit';
import {
  mcpHealthProbeRateLimit,
  mcpRateLimitKeyNamespace,
  mcpSlidingWindowStore,
} from '$lib/server/oauth/configuration';

/**
 * Rate-limits `/health` through the library's generic `SlidingWindowRateLimiter`
 * (TRI-56 AC3). `health_probe` is not one of the library's OAuth categories, so it
 * uses the generic limiter with a host-owned key over the shared sliding-window
 * store — not a hand-rolled counter.
 */
const healthProbeLimiter = new SlidingWindowRateLimiter();

/**
 * Returns a 429 when the caller has exceeded the health-probe budget, or `null` to
 * proceed. Fails OPEN on any limiter error: `/health` is Fly's liveness and
 * bluegreen-promotion gate, so a rate-limiter (Redis) outage must not take it
 * down — that would block deploys and machine promotion during the very incident
 * the health check exists to surface. The MCP surface fails closed; the health
 * gate deliberately does not, and the response's Redis dependency probe still
 * reports the outage.
 */
export async function enforceHealthProbeRateLimit(clientAddress: string): Promise<Response | null> {
  try {
    const result = await healthProbeLimiter.consume({
      key: `rate_limit:${mcpRateLimitKeyNamespace}:health_probe:${clientAddress}`,
      maximumRequests: mcpHealthProbeRateLimit.maximumRequests,
      windowSeconds: mcpHealthProbeRateLimit.windowSeconds,
      atomicStore: mcpSlidingWindowStore,
    });
    if (result.allowed) return null;
    return Response.json(
      { error: 'rate_limited', error_description: 'Too many health probes' },
      { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
    );
  } catch (error) {
    console.error('Health-probe rate limiter error (serving health anyway):', error);
    return null;
  }
}
