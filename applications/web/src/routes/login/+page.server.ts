import { redirect } from '@sveltejs/kit';
import { isNeonAuthConfigured } from '$lib/server/auth/neon-auth-configured';
import { sanitizeReturnTo } from '$lib/utilities/return-to';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  if (event.locals.user) {
    // A transient infrastructure failure (see hooks.server.ts's
    // TransientAuthInfrastructureError handling) can bounce an
    // already-authenticated user through here once, mid-navigation, if
    // validation failed on the request that redirected here but the cookie
    // is still intact and succeeds on this one. Preserve their original
    // destination instead of always sending them to '/' -- otherwise a
    // one-request JWKS or database hiccup silently loses a deep link.
    redirect(302, sanitizeReturnTo(event.url.searchParams.get('returnTo')));
  }

  return {
    neonAuthConfigured: isNeonAuthConfigured(),
  };
};
