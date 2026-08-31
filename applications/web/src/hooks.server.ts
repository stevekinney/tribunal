import type { Handle, ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import {
  deleteNeonAuthTokenCookie,
  neonAuthTokenCookieName,
  TransientAuthInfrastructureError,
  validateNeonSessionFromToken,
} from '$lib/server/auth/neon-session';
import { devAuthBypassHandle } from '$lib/server/auth/dev-bypass';
import { respondWithJsonForApiEndpoints } from '$lib/utilities/json-response';
import { e2eHandle } from '$testing/end-to-end/handle';
import { warnOnGitHubAppConfigurationDriftAtStartup } from '$lib/server/github/webhooks/subscription-drift';
import { assertNeonAuthConfigured } from '$lib/server/auth/neon-auth-configured';

/**
 * Runs once before the server responds to its first request.
 *
 * Fires the GitHub App webhook subscription drift check without awaiting it
 * — a slow or failing GitHub API call must never delay the server's first
 * response, matching this codebase's existing "never block startup on an
 * external call" convention (see `github-context.ts`'s `resolveWeftClient`
 * comment). The check only ever logs; see `subscription-drift.ts` for why
 * it is a warning rather than a startup guard that throws.
 */
export const init: ServerInit = () => {
  if (!building && !dev && env.E2E_TEST_MODE !== '1') {
    assertNeonAuthConfigured();
  }

  void warnOnGitHubAppConfigurationDriftAtStartup().catch((error) => {
    console.error('[github-app-configuration] Unexpected error during startup drift check:', error);
  });
};

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
    const { user, neonSession } = await validateNeonSessionFromToken(neonAuthToken);
    event.locals.user = user;
    event.locals.neonSession = neonSession;
  } catch (validationError) {
    event.locals.user = null;
    event.locals.neonSession = null;

    if (validationError instanceof TransientAuthInfrastructureError) {
      // Infrastructure hiccup (JWKS fetch, database), not an invalid token:
      // leave the cookie intact so the client's next request can retry
      // instead of forcing a full GitHub OAuth re-prompt.
      console.error('[hooks.server] Neon Auth session check failed transiently', {
        correlationId: event.locals.correlationId,
        requestId: event.locals.requestId,
        message:
          validationError.cause instanceof Error
            ? validationError.cause.message
            : String(validationError.cause),
      });
      return resolve(event);
    }

    console.error('[hooks.server] Invalidating Neon Auth session cookie', {
      correlationId: event.locals.correlationId,
      requestId: event.locals.requestId,
      message: validationError instanceof Error ? validationError.message : String(validationError),
    });
    deleteNeonAuthTokenCookie(event);
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
 * - devAuthBypassHandle: Dev-only. When DEV_AUTH_BYPASS=1 in a dev runtime,
 *   overrides locals with an auto-logged-in local user so the authenticated UI
 *   is reachable in preview sandboxes. A no-op pass-through otherwise. Runs last
 *   so it wins over authHandle's cookie-derived session.
 */
export const handle = sequence(
  correlationHandle,
  e2eHandle,
  respondWithJsonForApiEndpoints,
  authHandle,
  devAuthBypassHandle,
);
