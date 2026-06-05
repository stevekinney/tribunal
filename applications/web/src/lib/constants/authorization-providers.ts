/**
 * Shared authentication provider constants.
 * Safe for client/server use - no server dependencies.
 *
 * IMPORTANT: Must stay in sync with AUTH_PROVIDERS in $lib/server/auth/providers.ts
 */

export const AUTH_PROVIDER_LIST = ['github'] as const;
export type AuthProvider = (typeof AUTH_PROVIDER_LIST)[number];

/**
 * Error messages for login page.
 */
export const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  github_denied: "You cancelled the sign in. Click a button below when you're ready to try again.",
  github_failed: 'GitHub authentication failed. Please try again.',
  github_oauth_not_configured:
    'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.',
  neon_auth_not_configured:
    'Neon Auth is not configured. Set PUBLIC_NEON_AUTH_URL and NEON_AUTH_BASE_URL, then restart the development server.',
  neon_auth_failed: 'Neon Auth could not complete sign in. Please try again.',
  neon_auth_token_missing:
    'Neon Auth completed, but did not return a session token. Please try again.',
  neon_auth_session_failed:
    'Neon Auth completed, but Tribunal could not create a local session. Check the development server logs.',
};
