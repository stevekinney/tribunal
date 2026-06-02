/**
 * Shared authentication provider constants.
 * Safe for client/server use - no server dependencies.
 *
 * IMPORTANT: Must stay in sync with AUTH_PROVIDERS in $lib/server/auth/providers.ts
 */

export const AUTH_PROVIDER_LIST = ['github'] as const;
export type AuthProvider = (typeof AUTH_PROVIDER_LIST)[number];

/** Providers shown in the UI. Server routes for unlisted providers are preserved. */
export const ENABLED_SIGN_IN_PROVIDERS: AuthProvider[] = ['github'];

export function isValidProvider(value: string): value is AuthProvider {
  return AUTH_PROVIDER_LIST.includes(value as AuthProvider);
}

/**
 * Human-readable names for auth providers.
 */
export const AUTH_PROVIDER_NAMES: Record<AuthProvider, string> = {
  github: 'GitHub',
};

/**
 * Error messages for login page.
 */
export const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  github_denied: "You cancelled the sign in. Click a button below when you're ready to try again.",
  github_failed: 'GitHub authentication failed. Please try again.',
  email_conflict:
    'An account with this email already exists. Sign in with your original provider, then connect this one in Settings.',
  email_required:
    'A verified email address is required for this sign-in method. Please verify your email with your provider, or try a different sign-in method.',
  handle_unavailable: 'Your username is not available as a handle. Please contact support.',
  session_expired: 'Your session has expired. Please sign in again.',
  reauth_expired: 'Your re-authentication session expired. Please try again.',
};

/**
 * Error messages for security settings page.
 */
export const SECURITY_ERROR_MESSAGES: Record<string, string> = {
  already_linked: 'This account is already linked.',
  provider_linked: 'This provider account is already connected to another Tribunal account.',
  wrong_account: 'You signed in with a different account. Use your linked account.',
  session_mismatch: 'Session mismatch. Please try again.',
  session_expired: 'Your session expired. Please try again.',
  unknown_provider: 'Unknown provider.',
  github_link_required:
    'To install GitHub Apps, you need to connect your GitHub account first. Click "Connect GitHub" below.',
  github_token_revoked:
    'Your GitHub connection is no longer valid. Please reconnect your GitHub account below.',
};

/**
 * Success messages for security settings page.
 */
export const SECURITY_SUCCESS_MESSAGES: Record<string, string> = {
  github_linked: 'GitHub account linked successfully!',
};
