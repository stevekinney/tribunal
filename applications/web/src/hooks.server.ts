import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env } from '$env/dynamic/private';
import {
  createNeonSessionFromToken,
  deleteNeonAuthTokenCookie,
  neonAuthTokenCookieName,
} from '$lib/server/auth/neon-session';
import { respondWithJsonForApiEndpoints } from '$lib/utilities/json-response';
import { e2eHandle } from '$testing/end-to-end/handle';

/**
 * Correlation tracking handle.
 * Injects correlationId and requestId into event.locals for cross-layer tracing,
 * and propagates both values to response headers for client-side correlation.
 *
 * - correlationId: Extracted from X-Correlation-Id header or generated if missing
 * - requestId: Unique per HTTP request, always generated
 * - Response headers X-Correlation-ID and X-Request-ID are set on every response
 */
const correlationHandle: Handle = async ({ event, resolve }) => {
  const correlationId =
    event.request.headers.get('x-correlation-id') || `corr-${crypto.randomUUID()}`;
  const requestId = `req-${crypto.randomUUID()}`;

  event.locals.correlationId = correlationId;
  event.locals.requestId = requestId;

  const response = await resolve(event);
  response.headers.set('X-Correlation-ID', correlationId);
  response.headers.set('X-Request-ID', requestId);
  return response;
};

/**
 * Production authentication handle.
 * Validates Neon Auth bridge cookies and sets user/neonSession on locals.
 *
 * In E2E mode, e2eHandle already handles auth token validation against
 * per-worker databases, so this handle skips to avoid re-validating
 * against the production db proxy (which requires AsyncLocalStorage context).
 */
export const authHandle: Handle = async ({ event, resolve }) => {
  if (env.E2E_TEST_MODE === '1') {
    return resolve(event);
  }

  const neonAuthToken = event.cookies.get(neonAuthTokenCookieName);

  if (!neonAuthToken) {
    event.locals.user = null;
    event.locals.neonSession = null;
    return resolve(event);
  }

  try {
    const { user, neonSession } = await createNeonSessionFromToken(neonAuthToken);
    event.locals.user = user;
    event.locals.neonSession = neonSession;
  } catch {
    deleteNeonAuthTokenCookie(event);
    event.locals.user = null;
    event.locals.neonSession = null;
  }

  return resolve(event);
};

/**
 * Composed handle: Correlation first, then E2E, then API JSON enforcement, then auth.
 *
 * - correlationHandle: Injects correlationId and requestId into event.locals.
 *   Runs first to ensure all subsequent handles have access to correlation context.
 * - e2eHandle: In production, a trivial pass-through. In E2E mode, intercepts
 *   /__e2e__/* endpoints and handles per-worker session validation.
 * - apiJsonHandle: Wraps /api/** routes so all error responses are JSON.
 *   Placed before authHandle so it catches auth-related errors too.
 * - authHandle: Validates Neon Auth bridge cookies and sets user/neonSession on locals.
 */
export const handle = sequence(
  correlationHandle,
  e2eHandle,
  respondWithJsonForApiEndpoints,
  authHandle,
);
