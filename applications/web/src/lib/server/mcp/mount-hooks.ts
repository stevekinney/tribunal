import type { Handle, RequestEvent } from '@sveltejs/kit';
import {
  primeSvelteKitMcpIdentity,
  type SvelteKitLikeRequestEvent,
} from '@lostgradient/mcp/sveltekit';
import { identityFromUser } from '$lib/server/oauth/identity';
import type { TribunalMcpMount } from './mount';

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
 * Primes the request's OAuth identity from `event.locals.user`. This MUST run
 * after every identity-populating handle — including `devAuthBypassHandle`,
 * which populates the synthetic preview user — so the mount never sees an
 * authenticated request as anonymous. It reads the locals the auth handles
 * populate rather than validating a token itself (a second identity path would
 * diverge from the first). The mount throws if it is reached without this
 * priming, so a sequence that places the mount handle first fails loudly.
 */
export function createMcpIdentityHandle(getMount: MountAccessor): Handle {
  return async ({ event, resolve }) => {
    if (getMount()) {
      const identity = event.locals.user ? identityFromUser(event.locals.user) : null;
      primeSvelteKitMcpIdentity(asMountEvent(event), identity);
    }
    return resolve(event);
  };
}

/**
 * Routes MCP and OAuth paths through the mount. When the surface is disabled,
 * it simply continues the chain: Tribunal has no routes at `/mcp` or
 * `/oauth/*`, so SvelteKit's own 404 is returned — byte-indistinguishable from
 * any other unknown path, which is the point (an unauthenticated prober must
 * not learn the surface exists).
 */
export function createMcpMountHandle(getMount: MountAccessor): Handle {
  return async ({ event, resolve }) => {
    const mountPromise = getMount();
    if (!mountPromise) return resolve(event);
    const { mount } = await mountPromise;
    return mount.handle({
      event: asMountEvent(event),
      resolve: (mountEvent) => resolve(mountEvent as unknown as RequestEvent),
    });
  };
}

/**
 * Adds `Cache-Control: no-store` to every 404 — the disabled-MCP 404 and every
 * ordinary 404 alike. A 404 is heuristically cacheable under RFC 9111, and the
 * discovery documents are unauthenticated GETs, so a cached stage-one 404 could
 * keep being served after the rollout flag flips and leave the surface
 * undiscoverable. Applying `no-store` to all 404s (not only MCP paths) keeps the
 * disabled response indistinguishable from an ordinary one while closing that
 * window. Runs first so it wraps the whole chain and sees the final response.
 */
export const cacheControlOn404Handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (response.status === 404) {
    response.headers.set('cache-control', 'no-store');
  }
  return response;
};
