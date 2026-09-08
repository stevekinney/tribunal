import type { HandleUnauthenticatedAuthorization } from '@lostgradient/mcp/oauth';

/**
 * When an unauthenticated browser hits `/oauth/authorize`, send it through
 * Tribunal's own sign-in, preserving the original authorize URL as `returnTo`
 * so the user lands back on the consent prompt after signing in. This mirrors
 * the `(authenticated)` layout guard, which redirects to
 * `/login?returnTo=<path>` — the same shape, so the login page's existing
 * `returnTo` handling carries the user back.
 */
export const handleUnauthenticatedAuthorization: HandleUnauthenticatedAuthorization = (request) => {
  const requestUrl = new URL(request.url);
  const returnTo = requestUrl.pathname + requestUrl.search;
  const location = `/login?returnTo=${encodeURIComponent(returnTo)}`;
  return new Response(null, { status: 302, headers: { location } });
};
