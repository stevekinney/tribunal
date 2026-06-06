import { error, isHttpError, json } from '@sveltejs/kit';
import { createNeonSessionFromToken, setNeonAuthTokenCookie } from '$lib/server/auth/neon-session';
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

  let sessionResult: Awaited<ReturnType<typeof createNeonSessionFromToken>>;
  try {
    sessionResult = await createNeonSessionFromToken(token);
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

  return json({
    user,
    neonSession: {
      neonAuthUserId: neonSession.neonAuthUserId,
      expiresAt: neonSession.expiresAt.toISOString(),
    },
  });
};
