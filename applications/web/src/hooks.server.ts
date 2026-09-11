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
import { isOperationalPath } from '$lib/server/operations/operational-paths';
import { respondWithJsonForApiEndpoints } from '$lib/utilities/json-response';
import { e2eHandle } from '$testing/end-to-end/handle';
import { warnOnGitHubAppConfigurationDriftAtStartup } from '$lib/server/github/webhooks/subscription-drift';
import { assertNeonAuthConfigured } from '$lib/server/auth/neon-auth-configured';
import { setLogger } from '@lostgradient/mcp';
import { mcpLogger } from '$lib/server/mcp-logger';
import { createTribunalMcpMount, type TribunalMcpMount } from '$lib/server/mcp/mount';
import { cacheControlOn404Handle, createMcpHandle } from '$lib/server/mcp/mount-hooks';
import {
  clearResourceUpdatePublisher,
  registerResourceUpdatePublisher,
} from '$lib/server/mcp/resource-updates';
import { isMcpEnabled } from '$lib/server/oauth/configuration';
import { parseWebEnvironment } from '$lib/server/environment';

/**
 * The process's single MCP + OAuth mount, constructed once at module scope when
 * the surface is enabled (and never during build/prerender). Disabled by
 * default via `MCP_ENABLED` (TRI-26 rollout flag); when null, the MCP handles
 * are inert and MCP/OAuth paths fall through to SvelteKit's ordinary 404.
 */
/**
 * How long, after the shutdown signal, to let adapter-node's concurrent HTTP
 * drain finish ordinary in-flight MCP requests before closing the transport
 * (TRI-51). Closing the transport aborts any request still in the handler's
 * `inflight` set — an ordinary tool call mid-exchange — so this window lets those
 * calls complete first. Tribunal's tools can take several seconds (a GitHub-
 * backed tool call waits on the API), so the window sits just below
 * `SHUTDOWN_TIMEOUT` (15s, deployment/fly/web.toml) to give ordinary calls almost
 * the whole drain window, keeping a small margin so the never-draining
 * `subscriptions/listen` streams — which only this transport close ends — still
 * close gracefully before adapter-node's force-close rather than being severed.
 *
 * The timer is `unref`'d (see the call site), so this large value costs nothing
 * in the common case: an `unref`'d timer only keeps firing while something else
 * (an open listen stream, or a long call) keeps the event loop alive, which is
 * exactly when the transport still needs closing. When ordinary requests drain
 * and no stream is open, the loop exits as soon as the work is done and this
 * timer never fires. Only a call still running within the last ~2s before
 * `SHUTDOWN_TIMEOUT` is cut short — and it would reach adapter-node's force-close
 * then anyway. Eliminating even that residual needs a listen-stream-specific
 * close the library does not expose (tracked upstream); see `stream-lifecycle.ts`.
 */
export const GRACE_BEFORE_TRANSPORT_SHUTDOWN_MS = 13_000;

const mcpMount: Promise<TribunalMcpMount> | null =
  !building && isMcpEnabled() ? createTribunalMcpMount() : null;

const getMcpMount = (): Promise<TribunalMcpMount> | null => mcpMount;

if (mcpMount) {
  // Register the mount's resource-update publisher so the review layer's
  // producer (notifyReviewRunsChanged) can reach a live subscriber (TRI-126).
  // Best-effort: a construction failure is logged (below) and leaves the
  // notifier a no-op.
  void mcpMount
    .then((active) => registerResourceUpdatePublisher(active.publishUserResourceUpdate))
    .catch((error) => {
      // A mount that never constructs leaves the notifier unregistered (a
      // no-op), which is safe — but the failure must be observable rather than
      // swallowed, so the web process does not silently serve no MCP surface.
      console.error('[hooks.server] MCP resource-update publisher registration failed', error);
    });

  // Shutdown is two-phase, because a long-lived `subscriptions/listen` SSE stream
  // and an ordinary in-flight `/token` request want opposite ordering relative to
  // adapter-node's HTTP drain (TRI-51 AC3).
  //
  // Phase 1, on the signal (pre-drain): stop the sweep and close the MCP
  // transport. adapter-node's `httpServer.close()` waits for every open
  // connection, so a never-ending listen stream would otherwise hold the drain
  // open until `SHUTDOWN_TIMEOUT` force-closes it — losing the in-flight
  // notifications the `stream-lifecycle.ts` contract protects. Closing the
  // transport here ends those streams through the library's sanctioned path
  // (`cache.closeAll`) so the drain completes promptly and gracefully. We run it
  // off the raw signal, not `sveltekit:shutdown`, precisely because it must
  // happen *before* the drain. adapter-node also listens on these signals; its
  // `close()` is async and simply waits, so ordering between the two handlers is
  // immaterial.
  const shutdownMcpTransport = (): void => {
    // Stop the sweep immediately, not inside the deferred close: if the HTTP
    // drain (and therefore `disposePool`) completes inside the grace window — no
    // long-lived streams to hold it open — a still-pending sweep tick would
    // otherwise fire `purgeExpired` after the pool is ended. `mcpMount` is
    // already resolved, so this microtask runs before any macrotask sweep timer.
    void mcpMount
      .then((active) => active.stopCleanupSweep())
      .catch((error) => {
        console.error('[hooks.server] MCP cleanup-sweep stop failed', error);
      });
    // Wait a grace window before closing the transport: closing it aborts any
    // ordinary MCP request still in the handler's `inflight` set, so let
    // adapter-node's concurrent drain finish them first (see the constant's
    // comment). `unref` so this window never keeps the process alive on its own —
    // it fires only while an open listen stream or long call keeps the loop
    // alive, which is exactly when the transport still needs closing.
    const graceTimer = setTimeout(() => {
      // Clear the publisher just before the transport goes so a notification
      // cannot race the teardown. (Listen streams stay served through the grace
      // window; this close is what ends them.)
      clearResourceUpdatePublisher();
      void mcpMount
        .then((active) => active.shutdownTransport())
        .catch((error) => {
          console.error('[hooks.server] MCP transport shutdown failed', error);
        });
    }, GRACE_BEFORE_TRANSPORT_SHUTDOWN_MS);
    graceTimer.unref?.();
  };
  process.once('SIGTERM', shutdownMcpTransport);
  process.once('SIGINT', shutdownMcpTransport);

  // Phase 2, on `sveltekit:shutdown` (post-drain): close the OAuth connection
  // pool. adapter-node emits this only after in-flight requests have drained (or
  // been force-closed at `SHUTDOWN_TIMEOUT`), so an ordinary `/token` or
  // `/authorize` request — the only traffic that uses this pool — keeps its
  // connection through to completion rather than losing it mid-query. In dev and
  // under tests the event never fires; neither needs pool cleanup, since the
  // process is torn down wholesale.
  const disposeMcpPool = (): void => {
    void mcpMount
      .then((active) => active.disposePool())
      .catch((error) => {
        console.error('[hooks.server] MCP pool dispose failed', error);
      });
  };
  process.once('sveltekit:shutdown', disposeMcpPool);
}

const mcpHandle = createMcpHandle(getMcpMount);

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
  setLogger(mcpLogger);
  // Validate the environment before anything else so a misconfiguration fails
  // loudly at startup (SKIP_ENV_VALIDATION set, a bad NODE_ENV, or in production
  // NODE_TLS_REJECT_UNAUTHORIZED=0 / a DATABASE_URL without sslmode=verify-full)
  // rather than surfacing later as an obscure runtime error (TRI-44). Skipped
  // during build/prerender, when no runtime environment is expected.
  if (!building) {
    parseWebEnvironment(env);
  }
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

  if (isOperationalPath(event.url.pathname)) {
    event.locals.user = null;
    event.locals.neonSession = null;
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
  cacheControlOn404Handle,
  e2eHandle,
  respondWithJsonForApiEndpoints,
  authHandle,
  devAuthBypassHandle,
  mcpHandle,
);
