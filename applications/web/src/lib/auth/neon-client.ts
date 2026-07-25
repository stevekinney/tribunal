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
export const neonSessionResumeRefreshPendingMaximumMs = 1500;

// Cross-tab logout signal: `$lib/components/user-menu.svelte`'s sign-out
// form broadcasts on this channel (via `broadcastNeonSessionLogout`, in its
// `use:enhance` submit handler) before its POST to `/logout`
// (`routes/logout/+page.server.ts`'s default action) deletes the bridge
// cookie. Every tab running `startNeonSessionRefresh` listens and tears
// itself down immediately.
// Without this, a JWT minted before sign-out is still cryptographically
// valid, so a *different* tab's already-scheduled `getSession()`/bridge POST
// can complete after logout and silently recreate the session cookie --
// `AbortController` alone only cancels requests within the tab that created
// it, not another tab's.
const neonSessionLogoutBroadcastChannelName = 'tribunal-neon-auth-logout';

/**
 * Tells every other browser tab running `startNeonSessionRefresh` to stop
 * immediately. Call this as part of signing out, before (or alongside)
 * deleting the bridge cookie, so other tabs have the best chance of
 * cancelling their own in-flight refresh before it can recreate the cookie.
 * A no-op where `BroadcastChannel` isn't supported (e.g. older Safari) --
 * those tabs still fall back to the existing single-tab abort behavior.
 */
export function broadcastNeonSessionLogout(): void {
  if (typeof BroadcastChannel === 'undefined') return;

  const channel = new BroadcastChannel(neonSessionLogoutBroadcastChannelName);
  channel.postMessage('logout');
  channel.close();
}

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
   * teardown has already run (e.g. the user signed out) doesn't complete
   * afterward and recreate the session cookie.
   */
  signal?: AbortSignal;
};

export type PostNeonSessionTokenResult = {
  /**
   * Where the sign-in callback should go instead of `/` -- resolved once by
   * the session bridge (an extra "does this user have watched repositories?"
   * database check) so the callback can skip the intermediate `/` hop whose
   * own load function would otherwise make this exact same check. Only
   * present for the default (non-`refreshOnly`) sign-in request; the
   * periodic background refresh never reads this field.
   */
  postLoginPath?: string;
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
): Promise<PostNeonSessionTokenResult> {
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

  return (await response.json()) as PostNeonSessionTokenResult;
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
export async function refreshNeonSessionCookie(
  sessionData: unknown,
  options: RefreshNeonSessionCookieOptions = {},
): Promise<void> {
  const token = extractRefreshedSessionToken(sessionData);
  if (!token || token === lastPostedNeonSessionToken) return;

  try {
    await postNeonSessionToken(token, { refreshOnly: true, signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) return;
    console.error('Failed to refresh the Tribunal Neon Auth session cookie', error);
  }
}

export type StartNeonSessionRefreshOptions = {
  onResumeRefreshPendingChange?: (pending: boolean) => void;
  resumeRefreshPendingMaximumMs?: number;
};

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
 * cookie's `expires` mirrors the *most recently posted* token's own `exp`
 * (`neon-session.ts`'s `setNeonAuthTokenCookie` call), reset fresh on every
 * successful refresh -- not fixed at sign-in. A page reload can mount this
 * well into the current 15-minute window (SvelteKit's server load only
 * requires the cookie to still be valid, not fresh), so without a leading
 * call the cookie can expire before the first scheduled refresh ever fires.
 *
 * Deliberately does NOT gate scheduled refreshes on recent user activity
 * (mouse/keyboard/scroll), only on tab visibility (see below). An earlier
 * revision added an activity-based idle cutoff on top of the visibility
 * gate; it was removed after review (see `.claude/rules/authentication.md`'s
 * "Gate polling on tab visibility, not recent user activity" section)
 * because it let the cookie's lease lapse *before* the JWT it was tracking
 * actually expired, and the fix for that (an immediate refresh on the first
 * activity/visibility event after idling) raced the very next user gesture:
 * a `pointerdown` that both records activity and immediately navigates can
 * reach the server before the fire-and-forget refresh completes. Gating
 * only on hidden vs. visible removes that self-inflicted race entirely,
 * because the cookie then never has a chance to actually expire while the
 * tab is visible: this file's own refresh cadence (once every
 * `neonSessionRefreshIntervalMs`, a third of the JWT's lifetime) keeps
 * renewing it. The residual, irreducible cost/correctness trade-off left
 * genuinely open here: a visible-but-truly-unattended tab (nobody at the
 * keyboard, but not switched away or minimized either) keeps polling every
 * five minutes indefinitely, at one lightweight request per interval --
 * accepted deliberately, because the alternative (silently expiring an
 * open, visible session) is the exact bug this PR exists to fix.
 *
 * Scheduled (interval) refreshes ARE skipped while the tab is hidden
 * (`document.visibilityState === 'hidden'`), and a refresh fires once when
 * the tab becomes visible again. `deployment/fly/web.toml` sets
 * `auto_stop_machines = "stop"` / `min_machines_running = 0`; a tab that's
 * been switched away from or minimized would otherwise poll forever,
 * waking the web machine and Neon Postgres every five minutes and defeating
 * scale-to-zero for no visible benefit to anyone. The leading call above is
 * unconditional -- it exists to cover a page that mounts deep into the
 * JWT's window, which can happen even if the tab starts out hidden.
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
 * flight when the caller tears down (e.g. the user signing out, which
 * unmounts the authenticated shell this is running in) can resolve
 * afterward and recreate a valid Tribunal session cookie moments after
 * sign-out deleted it.
 *
 * Also stops itself the moment any tab calls `broadcastNeonSessionLogout` --
 * a visibility- and abort-signal-scoped fix only covers this one tab, and a
 * still-valid JWT minted before sign-out lets a *different* tab's refresh
 * outlive `/logout` and recreate the cookie there instead.
 */
export function startNeonSessionRefresh(
  authClient: Pick<ReturnType<typeof getNeonAuthClient>, 'getSession'>,
  options: StartNeonSessionRefreshOptions = {},
): () => void {
  const abortController = new AbortController();
  let stopped = false;
  let resumeRefreshPendingTimeout: ReturnType<typeof setTimeout> | undefined;
  let resumeRefreshPending = false;

  function setResumeRefreshPending(pending: boolean): void {
    if (resumeRefreshPending === pending) return;
    resumeRefreshPending = pending;
    options.onResumeRefreshPendingChange?.(pending);
  }

  function clearResumeRefreshPending(): void {
    if (resumeRefreshPendingTimeout) {
      clearTimeout(resumeRefreshPendingTimeout);
      resumeRefreshPendingTimeout = undefined;
    }
    setResumeRefreshPending(false);
  }

  function trackResumeRefresh(refreshPromise: Promise<void>): void {
    if (!options.onResumeRefreshPendingChange) return;

    clearResumeRefreshPending();
    setResumeRefreshPending(true);

    resumeRefreshPendingTimeout = setTimeout(
      clearResumeRefreshPending,
      options.resumeRefreshPendingMaximumMs ?? neonSessionResumeRefreshPendingMaximumMs,
    );

    void refreshPromise.finally(clearResumeRefreshPending);
  }

  function refresh(): Promise<void> {
    return authClient
      .getSession({ fetchOptions: { signal: abortController.signal } })
      .then((result) => {
        const data =
          typeof result === 'object' && result !== null
            ? (result as { data?: unknown }).data
            : undefined;
        return refreshNeonSessionCookie(data, { signal: abortController.signal });
      })
      .catch(() => {
        // Ignored: a rejected refresh (including one aborted by tearing this
        // down) isn't actionable here. A live tab simply tries again on its
        // next scheduled or visibility-triggered refresh.
      });
  }

  function refreshIfVisible(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    void refresh();
  }

  function handleVisibilityChange(): void {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    trackResumeRefresh(refresh());
  }

  void refresh();
  const intervalId = setInterval(refreshIfVisible, neonSessionRefreshIntervalMs);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  const logoutChannel =
    typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(neonSessionLogoutBroadcastChannelName)
      : undefined;

  function stop(): void {
    if (stopped) return;
    stopped = true;

    clearInterval(intervalId);
    clearResumeRefreshPending();
    abortController.abort();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    logoutChannel?.close();
  }

  if (logoutChannel) {
    logoutChannel.onmessage = () => stop();
  }

  return stop;
}
