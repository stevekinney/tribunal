import type { RequestEvent } from '@sveltejs/kit';
import { metricsCollector } from '@lostgradient/mcp';
import {
  authorizeOperationsRequest,
  operationsUnauthorizedResponse,
} from '$lib/server/operations/operations-auth';
import { enforceOperationsRateLimit } from '$lib/server/operations/operations-rate-limit';

/**
 * `/metrics` — the authenticated per-instance metrics endpoint (TRI-52).
 *
 * Exposes the library's `metricsCollector` snapshot (OBS-001 outcome counters for
 * the OAuth/MCP surfaces, plus tool latency percentiles), which the engine's own
 * handlers populate; Tribunal only serves it, it does not compute metrics itself.
 * Per-instance for the sole web Machine (singleton, TRI-83) — aggregation across
 * replicas is out of scope.
 *
 * Same order as `/health/ready`: rate-limit on every request before auth
 * (OPS-002), then authenticate, then serve. `Cache-Control: no-store` always.
 */
export async function GET({ request, getClientAddress }: RequestEvent): Promise<Response> {
  const rateLimited = await enforceOperationsRateLimit(getClientAddress());
  if (rateLimited) return rateLimited;

  const auth = authorizeOperationsRequest(request);
  if (!auth.authorized) return operationsUnauthorizedResponse(auth);

  return Response.json(metricsCollector.snapshot(), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
