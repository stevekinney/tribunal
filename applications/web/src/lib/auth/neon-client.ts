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

export type PostNeonSessionTokenOptions = {
  /**
   * When true, the session bridge only verifies the token and resets the
   * cookie's expiry -- it never creates or updates the mapped Tribunal
   * user's profile. Used by the periodic refresh path
   * (`refreshNeonSessionCookie`, `startNeonSessionRefresh`) so a
   * background refresh can't silently overwrite a profile field (e.g. an
   * avatar deliberately set by the GitHub account connect flow) that only
   * the explicit sign-in bridge call should own. Defaults to false (create
   * or update the mapped user), matching the sign-in callback's usage.
   */
  refreshOnly?: boolean;
  /**
   * Aborts the underlying `fetch` when the signal fires. Used by
   * `startNeonSessionRefresh` so a bridge POST kicked off by a refresh whose
   * teardown has already run (e.g. the user navigated away to `/logout`)
   * doesn't complete afterward and recreate the session cookie.
   */
  signal?: AbortSignal;
};

/**
 * POSTs a Neon Auth JWT to Tribunal's session-bridge endpoint
 * (`/api/auth/neon-session`), which verifies it and resets the httpOnly
 * `tribunal-neon-auth-token` cookie's expiry to match. Always performs the
 * request. Callers that only want to post a token when it has actually
 * changed should use `refreshNeonSessionCookie` instead.
 */
export async function postNeonSessionToken(
  token: string,
  options: PostNeonSessionTokenOptions = {},
): Promise<void> {
  const response = await fetch(neonSessionBridgeEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, refreshOnly: options.refreshOnly ?? false }),
    signal: options.signal,
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

export type RefreshNeonSessionCookieOptions = {
  /** Forwarded to `postNeonSessionToken` -- see its `signal` option. */
  signal?: AbortSignal;
};

/**
 * Posts a refreshed Neon Auth token to the session bridge, but only when it
 * differs from the last token posted -- better-auth mints a fresh JWT on
 * every `/get-session` call, so without this guard a burst of concurrent
 * calls would re-post needlessly. Fire-and-forget: callers (the periodic
 * scheduler below) don't block a UI action on this succeeding, they only log
 * if it fails -- except when the failure is the `signal` above firing, which
 * means the caller already tore this down and isn't waiting for a result.
 */
export function refreshNeonSessionCookie(
  sessionData: unknown,
  options: RefreshNeonSessionCookieOptions = {},
): void {
  const token = extractRefreshedSessionToken(sessionData);
  if (!token || token === lastPostedNeonSessionToken) return;

  void postNeonSessionToken(token, { refreshOnly: true, signal: options.signal }).catch(
    (error: unknown) => {
      if (options.signal?.aborted) return;
      console.error('Failed to refresh the Tribunal Neon Auth session cookie', error);
    },
  );
}

export function getNeonAuthClient() {
  const authUrl = env.PUBLIC_NEON_AUTH_URL;
  if (!authUrl) {
    throw new Error('PUBLIC_NEON_AUTH_URL is required to use Neon Auth');
  }

  return createAuthClient(authUrl, {
    adapter: BetterAuthVanillaAdapter(),
  });
}

/**
 * Starts periodic Neon Auth session refresh for the current browser tab.
 * Calling `getSession()` on an interval keeps triggering better-auth's
 * server-side JWT refresh (see `neonSessionRefreshIntervalMs`); each result
 * is bridged back into Tribunal's cookie via `refreshNeonSessionCookie`.
 * Returns a teardown function -- callers should stop the interval once the
 * authenticated session ends (e.g. on unmount).
 *
 * Calls `getSession()` immediately (in addition to the interval) rather than
 * only after the first `neonSessionRefreshIntervalMs` elapses. The bridged
 * cookie's `expires` mirrors the JWT's own `exp`, which is set once, at
 * whatever moment the token was minted -- not when this interval starts. A
 * page reload can mount this well into that 15-minute window (SvelteKit's
 * server load only requires the cookie to still be valid, not fresh), so
 * without a leading call the cookie can expire before the first scheduled
 * refresh ever fires.
 *
 * Scheduled (interval) refreshes are skipped while the tab is hidden, and a
 * refresh fires once when the tab becomes visible again. `deployment/fly/web.toml`
 * sets `auto_stop_machines = "stop"` / `min_machines_running = 0`; an
 * authenticated tab left open and merely backgrounded would otherwise poll
 * forever, waking the web machine and Neon Postgres every five minutes and
 * defeating scale-to-zero. The leading call above is unconditional -- it
 * exists to cover a page that mounts deep into the JWT's window, which can
 * happen even if the tab starts out hidden.
 *
 * The returned teardown function aborts both the in-flight `getSession()`
 * request AND the bridge POST it may have already kicked off (the same
 * `AbortSignal` is threaded through `refreshNeonSessionCookie` into
 * `postNeonSessionToken`'s own `fetch`), in addition to stopping the
 * interval and the visibility listener. Aborting only the outer
 * `getSession()` call is not enough: better-fetch resolves `getSession()`
 * only after awaiting its success hooks, but this module's own bridge POST is
 * fired-and-forgotten from inside that hook, so by the time `getSession()`
 * settles the bridge POST is already a separate, unsignaled request in
 * flight. Without threading the same signal into it, a request still in
 * flight when the caller tears down (e.g. navigating from the authenticated
 * shell to `/logout`) can resolve afterward and recreate a valid Tribunal
 * session cookie moments after `/logout` deleted it.
 */
export function startNeonSessionRefresh(
  authClient: Pick<ReturnType<typeof getNeonAuthClient>, 'getSession'>,
): () => void {
  const abortController = new AbortController();

  function refresh(): void {
    void authClient
      .getSession({ fetchOptions: { signal: abortController.signal } })
      .then((result) => {
        const data =
          typeof result === 'object' && result !== null
            ? (result as { data?: unknown }).data
            : undefined;
        refreshNeonSessionCookie(data, { signal: abortController.signal });
      })
      .catch(() => {
        // Ignored: a rejected refresh (including one aborted by tearing this
        // down) isn't actionable here. A live tab simply tries again on its
        // next scheduled or visibility-triggered refresh.
      });
  }

  function refreshIfVisible(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    refresh();
  }

  function handleVisibilityChange(): void {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    refresh();
  }

  refresh();
  const intervalId = setInterval(refreshIfVisible, neonSessionRefreshIntervalMs);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  return () => {
    clearInterval(intervalId);
    abortController.abort();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };
}
