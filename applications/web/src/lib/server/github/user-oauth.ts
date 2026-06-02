/**
 * User OAuth Octokit factory for GitHub write operations.
 *
 * Write operations should use user OAuth tokens (not installation tokens)
 * to maintain proper attribution. This module provides:
 * - User Octokit client creation
 * - OAuth scope validation
 * - Token refresh handling
 */
import { Octokit } from 'octokit';
import { getOAuthConnection, refreshGitHubTokenIfNeeded } from '$lib/server/auth/authentication';
import { parseScopes, type UserScopes } from './access';

// ============================================================================
// Types
// ============================================================================

export type { UserScopes } from './access';

/**
 * Result of getting a user Octokit client.
 */
export type UserOctokitResult =
  | { ok: true; octokit: Octokit; scopes: UserScopes }
  | { ok: false; error: UserOctokitError; message: string };

export type UserOctokitError =
  | 'no_token' // User has no GitHub OAuth connection
  | 'token_expired' // Token expired and refresh failed
  | 'token_invalid' // Token was marked as invalid
  | 'token_decrypt_failed'; // Failed to decrypt stored token

// ============================================================================
// User Octokit Factory
// ============================================================================

/**
 * Get an Octokit client authenticated with a user's OAuth token.
 *
 * Use this for write operations that should be attributed to the user.
 * The token is refreshed if needed (for GitHub App user-to-server tokens).
 *
 * @param userId - The user ID to get the Octokit client for
 * @returns Result containing the Octokit client and scopes, or an error
 */
export async function getUserOctokit(userId: number): Promise<UserOctokitResult> {
  // Try to refresh token if needed (handles expiring tokens)
  const accessToken = await refreshGitHubTokenIfNeeded(userId);
  const connection = await getOAuthConnection(userId, 'github');

  if (!accessToken) {
    // Refresh failed or no token - check why
    if (!connection) {
      return {
        ok: false,
        error: 'no_token',
        message: 'No GitHub connection found. Please connect your GitHub account.',
      };
    }

    if (!connection.accessToken) {
      return {
        ok: false,
        error: 'token_decrypt_failed',
        message: 'Failed to access GitHub token. Please reconnect your GitHub account.',
      };
    }

    // Token exists but refresh failed - likely expired without refresh token
    return {
      ok: false,
      error: 'token_expired',
      message: 'Your GitHub session has expired. Please sign in again.',
    };
  }

  // Get scope info from stored connection
  const scopes = parseScopes(connection?.scope ?? null);

  // Create Octokit with user token
  const octokit = new Octokit({ auth: accessToken });

  return {
    ok: true,
    octokit,
    scopes,
  };
}
