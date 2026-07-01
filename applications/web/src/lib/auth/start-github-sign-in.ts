import { getNeonAuthClient } from './neon-client';

type StartGithubSignInOptions = {
  /** Whether Neon Auth is configured — see `isNeonAuthConfigured` on the server. */
  neonAuthConfigured: boolean;
  /** Sanitized in-app path to return to after the OAuth round-trip. */
  returnTo: string;
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
}: StartGithubSignInOptions): Promise<void> {
  if (!neonAuthConfigured) {
    window.location.href = `/login?error=neon_auth_not_configured&returnTo=${encodeURIComponent(returnTo)}`;
    return;
  }

  try {
    const callbackUrl = new URL('/auth/callback', window.location.origin);
    callbackUrl.searchParams.set('returnTo', returnTo);
    const errorCallbackUrl = new URL('/login', window.location.origin);
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

    window.location.href = result.data.url;
  } catch (error) {
    console.error('Neon Auth GitHub sign-in failed to start', error);
    window.location.href = `/login?error=neon_auth_failed&returnTo=${encodeURIComponent(returnTo)}`;
    throw error;
  }
}
