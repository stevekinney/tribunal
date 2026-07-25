import { env } from '$env/dynamic/public';
import { createAuthClient } from '@neondatabase/neon-js/auth';
import { BetterAuthVanillaAdapter } from '@neondatabase/neon-js/auth/vanilla/adapters';

const neonSessionBridgeEndpoint = '/api/auth/neon-session';

// Better Auth's jwt plugin (node_modules/better-auth/dist/plugins/jwt/index.mjs)
// mints a brand-new, short-lived JWT -- 15 minutes by default -- on every
// `/get-session` request and returns it via the `set-auth-jwt` response
// header. This interval drives periodic `getSession()` calls comfortably
// inside that window so the bridged Tribunal cookie (whose `expires` mirrors
// the JWT's own `exp`) never goes stale while the user is active.
export const neonSessionRefreshIntervalMs = 5 * 60 * 1000;

let lastPostedNeonSessionToken: string | null = null;

/**
 * POSTs a Neon Auth JWT to Tribunal's session-bridge endpoint
 * (`/api/auth/neon-session`), which verifies it and resets the httpOnly
 * `tribunal-neon-auth-token` cookie's expiry to match. Always performs the
 * request. Callers that only want to post a token when it has actually
 * changed should use `refreshNeonSessionCookie` instead.
 */
export async function postNeonSessionToken(token: string): Promise<void> {
  const response = await fetch(neonSessionBridgeEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `Tribunal could not establish a Neon Auth session (status ${response.status}): ${responseBody}`,
    );
  }

  lastPostedNeonSessionToken = token;
}

function extractRefreshedSessionToken(candidate: unknown): string | null {
  if (typeof candidate !== 'object' || candidate === null) return null;

  const session = (candidate as { session?: unknown }).session;
  if (typeof session !== 'object' || session === null) return null;

  const token = (session as { token?: unknown }).token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/**
 * Posts a refreshed Neon Auth token to the session bridge, but only when it
 * differs from the last token posted -- better-auth mints a fresh JWT on
 * every `/get-session` call, so without this guard a burst of concurrent
 * calls would re-post needlessly. Fire-and-forget: callers (the client's
 * `onSuccess` hook, the periodic scheduler below) don't block a UI action on
 * this succeeding, they only log if it fails.
 */
export function refreshNeonSessionCookie(sessionData: unknown): void {
  const token = extractRefreshedSessionToken(sessionData);
  if (!token || token === lastPostedNeonSessionToken) return;

  void postNeonSessionToken(token).catch((error: unknown) => {
    console.error('Failed to refresh the Tribunal Neon Auth session cookie', error);
  });
}

export function getNeonAuthClient() {
  const authUrl = env.PUBLIC_NEON_AUTH_URL;
  if (!authUrl) {
    throw new Error('PUBLIC_NEON_AUTH_URL is required to use Neon Auth');
  }

  return createAuthClient(authUrl, {
    adapter: BetterAuthVanillaAdapter({
      fetchOptions: {
        onSuccess: (context: { data?: unknown }) => refreshNeonSessionCookie(context.data),
      },
    }),
  });
}

/**
 * Starts periodic Neon Auth session refresh for the current browser tab.
 * Calling `getSession()` on an interval keeps triggering better-auth's
 * server-side JWT refresh (see `neonSessionRefreshIntervalMs`); the client's
 * `onSuccess` hook (wired in `getNeonAuthClient`) bridges the result back
 * into Tribunal's cookie. Returns a teardown function -- callers should stop
 * the interval once the authenticated session ends (e.g. on unmount).
 *
 * Calls `getSession()` immediately (in addition to the interval) rather than
 * only after the first `neonSessionRefreshIntervalMs` elapses. The bridged
 * cookie's `expires` mirrors the JWT's own `exp`, which is set once, at
 * whatever moment the token was minted -- not when this interval starts. A
 * page reload can mount this well into that 15-minute window (SvelteKit's
 * server load only requires the cookie to still be valid, not fresh), so
 * without a leading call the cookie can expire before the first scheduled
 * refresh ever fires.
 */
export function startNeonSessionRefresh(
  authClient: Pick<ReturnType<typeof getNeonAuthClient>, 'getSession'>,
): () => void {
  void authClient.getSession();

  const intervalId = setInterval(() => {
    void authClient.getSession();
  }, neonSessionRefreshIntervalMs);

  return () => clearInterval(intervalId);
}
