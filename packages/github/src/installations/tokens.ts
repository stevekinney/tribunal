/**
 * Installation token minting utilities shared by server and workers.
 *
 * - `createInstallationToken` is pure and accepts an App instance.
 * - `mintInstallationAccessToken` is the server convenience wrapper that
 *   resolves the app from context and throws when it is not configured.
 */

import type { App } from 'octokit';
import type { GithubServiceContext } from '../context.js';
import { ValidationError } from '../error-taxonomy.js';
import { classifyTokenError, type InstallationTokenError } from '@tribunal/github/token-errors';

// ============================================================================
// Types
// ============================================================================

/**
 * Installation token with explicit expiration.
 * Token TTL is typically one hour from GitHub.
 */
export interface InstallationToken {
  /** The installation access token */
  token: string;
  /** ISO 8601 timestamp when token expires */
  expiresAt: string;
  /** Installation ID (echoed back for verification) */
  installationId: number;
}

/**
 * Options for creating an installation access token.
 */
export interface CreateInstallationTokenOptions {
  installationId: number;
  /** Repository IDs to scope the token to (optional, for defense in depth) */
  repositoryIds?: number[];
  /** Specific permissions to request (optional, uses installation defaults) */
  permissions?: {
    contents?: 'read' | 'write';
    metadata?: 'read';
  };
}

/**
 * Result type for installation token creation.
 */
export type CreateInstallationTokenResult =
  | { ok: true; token: InstallationToken }
  | { ok: false; error: InstallationTokenError };

// ============================================================================
// Core Function
// ============================================================================

/**
 * Create an installation access token via GitHub's API.
 *
 * @param app - GitHub App instance (caller provides — no singleton dependency)
 * @param options - Installation ID and optional scoping
 * @returns Discriminated union: ok with token, or error with classification
 */
export async function createInstallationToken(
  app: App,
  options: CreateInstallationTokenOptions,
): Promise<CreateInstallationTokenResult> {
  try {
    const response = await app.octokit.rest.apps.createInstallationAccessToken({
      installation_id: options.installationId,
      ...(options.repositoryIds?.length && { repository_ids: options.repositoryIds }),
      ...(options.permissions && { permissions: options.permissions }),
    });

    return {
      ok: true,
      token: {
        token: response.data.token,
        expiresAt: response.data.expires_at,
        installationId: options.installationId,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: classifyTokenError(error, options.installationId),
    };
  }
}

// ============================================================================
// Server Convenience Wrapper
// ============================================================================

/**
 * Mint an installation access token using the GitHub App from context.
 *
 * @param context - GitHub service dependency injection context
 * @param options - Installation ID and optional scoping
 * @returns Discriminated union result from createInstallationToken
 * @throws ValidationError if GitHub App is not configured or context lacks getGithubApplication
 */
export async function mintInstallationAccessToken(
  context: GithubServiceContext,
  options: CreateInstallationTokenOptions,
): Promise<CreateInstallationTokenResult> {
  if (!context.getGithubApplication) {
    throw new ValidationError(
      'GitHub App is not configured. The context does not provide getGithubApplication.',
    );
  }

  const app = context.getGithubApplication();

  if (!app) {
    throw new ValidationError(
      'GitHub App is not configured. Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY environment variables.',
    );
  }

  return createInstallationToken(app, options);
}
