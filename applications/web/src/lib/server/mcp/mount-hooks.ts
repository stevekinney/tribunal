import { dev } from '$app/environment';
import type { Handle, RequestEvent } from '@sveltejs/kit';
import {
  primeSvelteKitMcpIdentity,
  type SvelteKitLikeRequestEvent,
} from '@lostgradient/mcp/sveltekit';
import { isDevAuthBypassEnabled } from '$lib/server/auth/dev-auth-bypass-flag';
import { isOperationalPath } from '$lib/server/operations/operational-paths';
import { identityFromUser } from '$lib/server/oauth/identity';
import type { TribunalMcpMount } from './mount';

/** True for the paths the mount owns (`/mcp`, OAuth endpoints, discovery docs). */
export function isMcpSurfacePath(pathname: string): boolean {
  return (
    pathname === '/mcp' ||
    pathname.startsWith('/oauth/') ||
    pathname.startsWith('/.well-known/oauth-')
  );
}

/**
 * Applies security headers to the mounted surface's responses (AC4/AC5). Only
 * responses for mount-owned paths are decorated, so the disabled-state 404 —
 * which reaches `resolve` for a path with no route — stays byte-indistinguishable
 * from an ordinary 404 (AC7). The library sets `Cache-Control` on its own JSON
 * responses, so this only sets caching headers on HTML (the consent page),
 * avoiding a conflict. Headers are mutated in place; the mount builds its
 * responses with `new Response`, whose headers are mutable.
 */
export function applyMcpSecurityHeaders(response: Response, pathname: string): Response {
  const headers = response.headers;
  headers.set('x-content-type-options', 'nosniff');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()');
  if (!dev) {
    headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains');
  }
  // Transaction-carrying OAuth paths must not leak the transaction id or CSRF
  // token to the external client through the Referer header. `same-origin` drops
  // the referrer on any cross-origin navigation (the client's redirect_uri never
  // sees the authorize URL) while keeping it for the same-origin approve/deny
  // POST. `no-referrer` cannot be used here: per Fetch's "append a request Origin
  // header", a non-GET request under `no-referrer` has its Origin set to `null`,
  // so the browser posts consent with `Origin: null` and SvelteKit's built-in
  // CSRF check (which runs before the handle hook and compares Origin to the
  // server origin) rejects it as a cross-site submission.
  if (pathname.startsWith('/oauth/')) {
    headers.set('referrer-policy', 'same-origin');
  }
  if ((headers.get('content-type') ?? '').includes('text/html')) {
    headers.set('cache-control', 'no-store, private');
    // Append to any existing Vary (e.g. Origin the mount may set) rather than
    // overwriting it, and avoid duplicating Cookie.
    const existingVary = headers.get('vary');
    const varyValues = existingVary ? existingVary.split(',').map((value) => value.trim()) : [];
    if (!varyValues.some((value) => value.toLowerCase() === 'cookie')) {
      headers.set('vary', [...varyValues, 'Cookie'].join(', '));
    }
  }
  return response;
}

/**
 * The library's mount works against a structural subset of SvelteKit's event
 * (`locals` as an index signature; `resolve` needing fewer fields). SvelteKit's
 * concrete `RequestEvent`/`resolve` are supersets, so they satisfy the subset
 * at runtime — the mount only reads `request`/`url`/`locals`/`getClientAddress`
 * and passes the same event straight back to `resolve` — but they are not
 * type-level assignable. This bridges that boundary in one place.
 */
function asMountEvent(event: RequestEvent): SvelteKitLikeRequestEvent {
  return event as unknown as SvelteKitLikeRequestEvent;
}

/**
 * The SvelteKit handles that integrate the MCP + OAuth mount into Tribunal's
 * handle chain. Built as factories over a mount accessor so tests can inject a
 * mount (or none) and compose deliberately misordered sequences — the mount's
 * identity guard only fails against a real `sequence()`, which is what
 * `hooks.server.ts` composes.
 *
 * `getMount` returns the process's single mount (a pending promise while it
 * constructs) or `null` when the surface is disabled.
 */
type MountAccessor = () => Promise<TribunalMcpMount> | null;

/**
 * Derives the OAuth identity the mount should see from `event.locals.user`.
 *
 * The dev auth bypass (`devAuthBypassHandle`) is deliberately excluded: it
 * populates a synthetic user for browsing the authenticated UI in a sandboxed
 * preview, and must never stand in as the OAuth resource owner on the mounted
 * surface. An armed bypass may be externally reachable (a tunnel), and priming
 * its identity would let an external client complete `/oauth/authorize` as the
 * synthetic user and mint a real token — an authenticated MCP session produced
 * with no login. When the bypass is armed we return `null`, so the mount falls
 * back to the cookie-based identity seam (`resolveIdentityBinding`), which a
 * bypass session (it sets no Neon Auth cookie) cannot satisfy (TRI-45).
 */
function mcpIdentityFor(event: RequestEvent) {
  return !isDevAuthBypassEnabled() && event.locals.user
    ? identityFromUser(event.locals.user)
    : null;
}

/**
 * The single SvelteKit handle that primes identity and routes MCP + OAuth paths
 * through the mount, in one step.
 *
 * Priming and serving must share one `event` object. SvelteKit's `sequence()`
 * gives every handler a distinct, tracing-wrapped event (`merge_tracing` spreads
 * a fresh object per handler), so a separate earlier identity handle would prime
 * the library's WeakMap on a different event than the mount later reads, and the
 * mount would reject every request as unprimed. Because `locals` is a shared
 * reference across those cloned events, reading `event.locals.user` here still
 * sees what `authHandle` populated — so this handle is placed after every
 * identity-populating handle (`authHandle`, `devAuthBypassHandle`).
 *
 * When the surface is disabled this continues the chain directly: Tribunal has
 * no route at `/mcp` or `/oauth/*`, so SvelteKit's own 404 is returned —
 * byte-indistinguishable from any other unknown path, which is the point (an
 * unauthenticated prober must not learn the surface exists). Security headers
 * are applied only to responses for mount-owned paths.
 */
export function createMcpHandle(getMount: MountAccessor): Handle {
  return async ({ event, resolve }) => {
    // Operational endpoints dispatch ahead of the MCP mount (TRI-52): awaiting the
    // shared mount promise gates every pathname, so a mount that is still
    // initializing or has failed would hang or fail /health, /health/ready, and
    // /metrics — the endpoints meant to diagnose that very incident. They own no
    // MCP surface, so skip the mount entirely for them.
    if (isOperationalPath(event.url.pathname)) return resolve(event);

    const mountPromise = getMount();
    if (!mountPromise) return resolve(event);

    const { mount } = await mountPromise;
    const mountEvent = asMountEvent(event);
    primeSvelteKitMcpIdentity(mountEvent, mcpIdentityFor(event));

    const response = await mount.handle({
      event: mountEvent,
      resolve: (resolvedEvent) => resolve(resolvedEvent as unknown as RequestEvent),
    });
    return isMcpSurfacePath(event.url.pathname)
      ? applyMcpSecurityHeaders(response, event.url.pathname)
      : response;
  };
}

/**
 * Adds `Cache-Control: no-store` to every 404 — the disabled-MCP 404 and every
 * ordinary 404 alike. A 404 is heuristically cacheable under RFC 9111, and the
 * discovery documents are unauthenticated GETs, so a cached stage-one 404 could
 * keep being served after the rollout flag flips and leave the surface
 * undiscoverable. Applying `no-store` to all 404s (not only MCP paths) keeps the
 * disabled response indistinguishable from an ordinary one while closing that
 * window. Sequenced right after `correlationHandle` so it wraps every
 * downstream handle and sees the final response.
 */
export const cacheControlOn404Handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (response.status === 404) {
    response.headers.set('cache-control', 'no-store');
  }
  return response;
};
