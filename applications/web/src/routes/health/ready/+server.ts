import type { RequestEvent } from '@sveltejs/kit';
import {
  authorizeOperationsRequest,
  operationsUnauthorizedResponse,
} from '$lib/server/operations/operations-auth';
import { enforceOperationsRateLimit } from '$lib/server/operations/operations-rate-limit';
import { getWebReadiness } from './readiness';

/**
 * `/health/ready` — the authenticated readiness endpoint (TRI-52).
 *
 * Distinct from the public `/health` liveness/bluegreen gate: this one requires a
 * bearer token, returns dependency detail only to that authenticated caller, and
 * serves TTL-cached, coalesced probe results so frequent polls do not each hit
 * Postgres/Redis. The public `/health` keeps its own deep probe (the Fly gate,
 * TRI-124/TRI-125) — this does not replace it.
 *
 * Order is deliberate: rate-limit first (on every request, before auth — OPS-002,
 * so a wrong-bearer guess still spends budget), then authenticate, then probe.
 * Every response carries `Cache-Control: no-store`.
 */
export async function GET({ request, getClientAddress }: RequestEvent): Promise<Response> {
  const rateLimited = await enforceOperationsRateLimit(getClientAddress());
  if (rateLimited) return rateLimited;

  const auth = authorizeOperationsRequest(request);
  if (!auth.authorized) return operationsUnauthorizedResponse(auth);

  try {
    const { ok, dependencies } = await getWebReadiness();
    return Response.json(
      { ok, dependencies },
      { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    // A stalled probe rejects past its deadline (see readiness.ts): report
    // unhealthy rather than hang, and let the cleared cache retry next request.
    return Response.json(
      {
        ok: false,
        dependencies: [],
        detail: error instanceof Error ? error.message : 'readiness probe failed',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
