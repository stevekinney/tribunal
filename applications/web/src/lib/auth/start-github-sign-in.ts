import { getNeonAuthClient } from './neon-client';

type StartGithubSignInOptions = {
  /** Whether Neon Auth is configured — see `isNeonAuthConfigured` on the server. */
  neonAuthConfigured: boolean;
  /** Sanitized in-app path to return to after the OAuth round-trip. */
  returnTo: string;
  /**
   * Origin used to build absolute callback URLs. Defaults to
   * `window.location.origin`. Overridable so this function is testable without
   * a browser environment — `window.location` is unforgeable in real browsers,
   * so tests can't stub it directly.
   */
  origin?: string;
  /**
   * Performs the actual browser navigation. Defaults to a real full-page
   * navigation (`window.location.href = url`). Overridable for the same
   * testability reason as `origin`.
   */
  navigate?: (url: string) => void;
};

const defaultNavigate = (url: string) => {
  window.location.href = url;
};

/**
 * Kicks off the Neon Auth GitHub OAuth flow from the browser.
 *
 * Shared by the welcome (`/`) and login (`/login`) pages so both entry points
 * behave identically. On success the browser is redirected to GitHub; every
 * failure path redirects back to `/login` with an error code (and rethrows so
 * the caller can restore its own loading state). This function always ends in a
 * navigation and never resolves normally on the happy path.
 */
export async function startGithubSignIn({
  neonAuthConfigured,
  returnTo,
  origin = window.location.origin,
  navigate = defaultNavigate,
}: StartGithubSignInOptions): Promise<void> {
  if (!neonAuthConfigured) {
    navigate(`/login?error=neon_auth_not_configured&returnTo=${encodeURIComponent(returnTo)}`);
    // Rethrow like every other failure path: the navigation above isn't
    // guaranteed to be instantaneous, so the caller needs to restore its own
    // loading state rather than get stuck showing "Redirecting...".
    throw new Error('Neon Auth is not configured');
  }

  try {
    const callbackUrl = new URL('/auth/callback', origin);
    callbackUrl.searchParams.set('returnTo', returnTo);
    const errorCallbackUrl = new URL('/login', origin);
    errorCallbackUrl.searchParams.set('error', 'neon_auth_failed');
    errorCallbackUrl.searchParams.set('returnTo', returnTo);

    const authClient = getNeonAuthClient();
    const result = await authClient.signIn.social({
      provider: 'github',
      callbackURL: callbackUrl.toString(),
      newUserCallbackURL: callbackUrl.toString(),
      errorCallbackURL: errorCallbackUrl.toString(),
      disableRedirect: true,
    });

    if (!result.data?.url) {
      throw new Error('Neon Auth did not return a GitHub OAuth URL');
    }

    navigate(result.data.url);
  } catch (error) {
    console.error('Neon Auth GitHub sign-in failed to start', error);
    navigate(`/login?error=neon_auth_failed&returnTo=${encodeURIComponent(returnTo)}`);
    throw error;
  }
}
