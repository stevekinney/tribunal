import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { constantTimeStringEqual } from '@tribunal/review-core/constant-time-string-equal';

const BEARER_PREFIX = 'Bearer ';

/**
 * SHA-256 of a token, base64url-encoded. Comparing the digests rather than the
 * raw tokens means the comparison always runs a fixed-length (43-char) input
 * through `constantTimeStringEqual`, so its length short-circuit never fires and
 * the presented token's length is never revealed by timing — the same shape as
 * `capability-token.ts`, which compares fixed-length HMAC digests.
 */
function tokenDigest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

export type OperationsAuthResult =
  { authorized: true } | { authorized: false; status: 401 | 503; reason: string };

/**
 * Authorizes a request to an authenticated operational endpoint (`/health/ready`,
 * `/metrics`) against `MCP_OPERATIONS_TOKEN` (TRI-52).
 *
 * The presented credential from the `Authorization` header is compared to the
 * configured token by their SHA-256 digests with `constantTimeStringEqual`, so
 * neither a partial match nor the token length can be distinguished by timing
 * (see `tokenDigest`). Fails closed: with no token configured the
 * endpoint is unavailable (503) rather than open, so a deployment that never set
 * the secret cannot serve readiness detail or metrics unauthenticated. A missing
 * or wrong bearer is 401.
 */
export function authorizeOperationsRequest(request: Request): OperationsAuthResult {
  const configuredToken = env.MCP_OPERATIONS_TOKEN;
  if (!configuredToken) {
    return {
      authorized: false,
      status: 503,
      reason: 'operational endpoints unavailable: MCP_OPERATIONS_TOKEN is not configured',
    };
  }

  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : '';
  if (constantTimeStringEqual(tokenDigest(presented), tokenDigest(configuredToken))) {
    return { authorized: true };
  }
  return { authorized: false, status: 401, reason: 'invalid or missing operational bearer token' };
}

/**
 * Builds the JSON denial response for an unauthorized operational request,
 * carrying `Cache-Control: no-store` (TRI-52 AC4) so a proxy never caches a
 * credentialed endpoint's response. Shared by `/health/ready` and `/metrics`.
 */
export function operationsUnauthorizedResponse(
  result: Extract<OperationsAuthResult, { authorized: false }>,
): Response {
  return Response.json(
    {
      error: result.status === 503 ? 'unavailable' : 'unauthorized',
      error_description: result.reason,
    },
    { status: result.status, headers: { 'Cache-Control': 'no-store' } },
  );
}
