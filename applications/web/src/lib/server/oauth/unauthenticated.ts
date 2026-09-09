import type { HandleUnauthenticatedAuthorization } from '@lostgradient/mcp/oauth';
import { isDevAuthBypassEnabled } from '$lib/server/auth/dev-auth-bypass-flag';

/**
 * When an unauthenticated browser hits `/oauth/authorize`, send it through
 * Tribunal's own sign-in, preserving the original authorize URL as `returnTo`
 * so the user lands back on the consent prompt after signing in. This mirrors
 * the `(authenticated)` layout guard, which redirects to
 * `/login?returnTo=<path>` — the same shape, so the login page's existing
 * `returnTo` handling carries the user back.
 *
 * Under the dev auth bypass this must not redirect to `/login`: the synthetic
 * bypass user is authenticated on every route, so `/login`'s load would
 * immediately redirect it back to `returnTo`, bouncing between `/oauth/authorize`
 * and `/login` forever. The bypass is deliberately not a valid OAuth resource
 * owner (TRI-45), so return a terminal 403 that names the cause instead.
 */
export const handleUnauthenticatedAuthorization: HandleUnauthenticatedAuthorization = (request) => {
  if (isDevAuthBypassEnabled()) {
    return new Response(
      'The development auth bypass cannot authorize OAuth clients on the mounted surface. ' +
        'Sign in with a real account, or unset DEV_AUTH_BYPASS, to use /oauth/authorize.',
      { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const requestUrl = new URL(request.url);
  const returnTo = requestUrl.pathname + requestUrl.search;
  const location = `/login?returnTo=${encodeURIComponent(returnTo)}`;
  return new Response(null, { status: 302, headers: { location } });
};
