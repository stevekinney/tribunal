import { error, isHttpError, json } from '@sveltejs/kit';
import {
  createNeonSessionFromToken,
  setNeonAuthTokenCookie,
  validateNeonSessionFromToken,
} from '$lib/server/auth/neon-session';
import { hasWatchedRepositories } from '$lib/server/review/operator';
import type { RequestHandler } from './$types';

const unexpectedSessionErrorMessage = 'Tribunal could not create a local session';

function getSessionErrorResponse(sessionError: unknown) {
  if (isHttpError(sessionError)) {
    return {
      status: sessionError.status,
      message: sessionError.body.message,
    };
  }

  return {
    status: 500,
    message: unexpectedSessionErrorMessage,
  };
}

export const POST: RequestHandler = async (event) => {
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    error(400, 'Expected JSON request body');
  }

  const token = typeof body === 'object' && body !== null && 'token' in body ? body.token : null;
  if (typeof token !== 'string' || token.length === 0) {
    error(400, 'Missing Neon Auth token');
  }

  // `refreshOnly` requests (the periodic session-refresh path in
  // `$lib/auth/neon-client.ts`) only verify the token and reset the cookie's
  // expiry -- they must never create or update the mapped user's profile.
  // Only the explicit sign-in bridge call (the default, `refreshOnly` unset)
  // is allowed to do that. See `$lib/auth/neon-client.ts`'s
  // `PostNeonSessionTokenOptions` for why.
  const refreshOnly =
    typeof body === 'object' && body !== null && 'refreshOnly' in body
      ? body.refreshOnly === true
      : false;

  let sessionResult: Awaited<ReturnType<typeof createNeonSessionFromToken>>;
  try {
    sessionResult = refreshOnly
      ? await validateNeonSessionFromToken(token)
      : await createNeonSessionFromToken(token);
  } catch (sessionError) {
    console.error('Failed to create Tribunal Neon Auth session', sessionError);
    const sessionErrorResponse = getSessionErrorResponse(sessionError);
    return json(
      {
        error: {
          code: 'neon_session_bridge_failed',
          message: sessionErrorResponse.message,
        },
      },
      { status: sessionErrorResponse.status },
    );
  }

  const { user, neonSession } = sessionResult;
  setNeonAuthTokenCookie(event, token, neonSession.expiresAt);

  // Resolved here, once, so the auth callback page can skip the intermediate
  // '/' hop (whose own load function makes this exact same "watched
  // repositories?" check before redirecting to '/repositories' or
  // '/onboarding') when it has no more specific destination of its own. The
  // callback only uses this when its `returnTo` is the default '/' — an
  // explicit deep link the user was headed to before signing in is still
  // respected as-is. '/' itself keeps this same check for anyone who lands
  // there directly (e.g. a bookmark), independent of this shortcut.
  //
  // Skipped for `refreshOnly` requests: the periodic background refresh
  // (`startNeonSessionRefresh`) never reads this field, so computing it (an
  // extra database query) on every five-minute refresh would be pure waste.
  const postLoginPath = refreshOnly
    ? undefined
    : (await hasWatchedRepositories(user.id))
      ? '/repositories'
      : '/onboarding';

  return json({
    user,
    neonSession: {
      neonAuthUserId: neonSession.neonAuthUserId,
      expiresAt: neonSession.expiresAt.toISOString(),
    },
    postLoginPath,
  });
};
