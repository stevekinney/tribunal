/**
 * Installation token error types and classification.
 *
 * Provides structured error types for GitHub installation token failures,
 * enabling proper retry behavior in durable workflows and actionable
 * error messages in the UI.
 *
 * Weft mapping: these retryability classifications feed
 * RetryPolicy.nonRetryableErrors (matched by error `name`) on the GitHub
 * activities' ActivityCallOptions — see error-taxonomy.ts.
 */

import type { Octokit } from 'octokit';
import {
  isRateLimitError,
  isNotFoundError,
  isForbiddenError,
  isUnauthorizedError,
  getRateLimitRetryAfter,
  getErrorMessage,
  isOctokitRequestError,
  getHeader,
} from './errors';

// ============================================================================
// Token Error Types
// ============================================================================

/**
 * Error codes for installation token failures.
 *
 * Classification:
 * - Non-retryable: suspended, not_found, insufficient_permissions, revoked, auth_failed
 * - Retryable: rate_limited (with backoff info), server_error (5xx / transient)
 */
export type InstallationTokenErrorCode =
  | 'suspended'
  | 'not_found'
  | 'insufficient_permissions'
  | 'rate_limited'
  | 'auth_failed'
  | 'revoked'
  | 'server_error';

/**
 * Structured installation token error.
 */
export interface InstallationTokenError {
  code: InstallationTokenErrorCode;
  message: string;
  installationId: number;
  /** Seconds until rate limit resets. Only present for rate_limited errors. */
  retryAfterSeconds?: number;
  /** True if this is a secondary/abuse rate limit (429) vs primary (403). */
  isSecondaryLimit?: boolean;
}

/**
 * Result type for scoped Octokit acquisition.
 *
 * Using discriminated union to preserve error context for both
 * UI display and workflow retry logic.
 */
export type ScopedOctokitResult =
  | { ok: true; octokit: Octokit; installationId: number }
  | { ok: false; error: InstallationTokenError };

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classify a GitHub API error into an InstallationTokenError.
 *
 * Uses existing type guards from errors.ts to categorize errors:
 * - 429 or 403 with rate limit indicators → rate_limited
 * - 404 → not_found
 * - 403 (non-rate-limit) → insufficient_permissions or suspended
 * - 401 → auth_failed or revoked
 *
 * @param error - The caught error
 * @param installationId - GitHub installation ID for context
 * @returns Structured error with classification
 */
export function classifyTokenError(error: unknown, installationId: number): InstallationTokenError {
  // Rate limit errors (429 or 403 with rate limit message)
  if (isRateLimitError(error)) {
    const retryAfterSeconds = getRateLimitRetryAfter(error) ?? undefined;
    // 429 = secondary/abuse rate limit, 403 = primary rate limit
    const isSecondaryLimit = isOctokitRequestError(error) && error.status === 429;

    return {
      code: 'rate_limited',
      message: `Installation ${installationId} rate limited. ${retryAfterSeconds ? `Retry after ${retryAfterSeconds}s.` : ''}`,
      installationId,
      retryAfterSeconds,
      isSecondaryLimit,
    };
  }

  // Secondary limits can return 403 with Retry-After but no rate limit message.
  if (
    isOctokitRequestError(error) &&
    error.status === 403 &&
    getHeader(error.response?.headers, 'retry-after')
  ) {
    const retryAfterSeconds = getRateLimitRetryAfter(error) ?? undefined;

    return {
      code: 'rate_limited',
      message: `Installation ${installationId} rate limited. ${retryAfterSeconds ? `Retry after ${retryAfterSeconds}s.` : ''}`,
      installationId,
      retryAfterSeconds,
      isSecondaryLimit: true,
    };
  }

  // Not found (installation deleted or uninstalled)
  if (isNotFoundError(error)) {
    return {
      code: 'not_found',
      message: `Installation ${installationId} not found. The app may have been uninstalled.`,
      installationId,
    };
  }

  // Forbidden (non-rate-limit) - permission denied or suspended
  if (isForbiddenError(error)) {
    // Check for suspension indicators in the error message
    const message = getErrorMessage(error).toLowerCase();
    if (message.includes('suspended')) {
      return {
        code: 'suspended',
        message: `Installation ${installationId} is suspended.`,
        installationId,
      };
    }

    return {
      code: 'insufficient_permissions',
      message: `Installation ${installationId} lacks required permissions.`,
      installationId,
    };
  }

  // Unauthorized - token invalid or revoked
  if (isUnauthorizedError(error)) {
    const message = getErrorMessage(error).toLowerCase();
    if (message.includes('revoked')) {
      return {
        code: 'revoked',
        message: `Installation ${installationId} authorization has been revoked.`,
        installationId,
      };
    }

    return {
      code: 'auth_failed',
      message: `Authentication failed for installation ${installationId}.`,
      installationId,
    };
  }

  // Server errors (5xx) — transient, should be retried
  if (isOctokitRequestError(error) && error.status >= 500) {
    return {
      code: 'server_error',
      message: `GitHub server error (${error.status}) for installation ${installationId}: ${getErrorMessage(error)}`,
      installationId,
    };
  }

  // Non-Octokit errors (network failures, timeouts) — transient, should be retried
  if (!isOctokitRequestError(error)) {
    return {
      code: 'server_error',
      message: `Transient error for installation ${installationId}: ${getErrorMessage(error)}`,
      installationId,
    };
  }

  // Default to auth_failed for unrecognized Octokit status codes
  return {
    code: 'auth_failed',
    message: `Failed to authenticate installation ${installationId}: ${getErrorMessage(error)}`,
    installationId,
  };
}

// ============================================================================
// Error Classification Helpers
// ============================================================================

/**
 * Check if an error code indicates a retryable condition.
 *
 * rate_limited and server_error are retryable - all other token errors
 * indicate permanent failures that won't resolve on retry.
 */
export function isRetryableTokenError(code: InstallationTokenErrorCode): boolean {
  return code === 'rate_limited' || code === 'server_error';
}

/**
 * Non-retryable error codes for workflow retry policy configuration.
 *
 * Wire these into a GitHub activity's `RetryPolicy.nonRetryableErrors` so a
 * suspended/revoked/not-found installation fails fast instead of burning retries.
 */
export const NON_RETRYABLE_TOKEN_ERROR_CODES: readonly InstallationTokenErrorCode[] = [
  'suspended',
  'not_found',
  'insufficient_permissions',
  'revoked',
  'auth_failed',
] as const;

/**
 * Type guard for InstallationTokenError.
 */
export function isInstallationTokenError(error: unknown): error is InstallationTokenError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'installationId' in error &&
    typeof (error as InstallationTokenError).code === 'string' &&
    typeof (error as InstallationTokenError).message === 'string' &&
    typeof (error as InstallationTokenError).installationId === 'number'
  );
}

/**
 * Create a rate limited error with retry timing.
 *
 * Utility for creating rate limit errors when detected preemptively
 * (e.g., from cached rate limit state before making an API call).
 */
export function createRateLimitedError(
  installationId: number,
  retryAfterSeconds: number,
  isSecondaryLimit: boolean = false,
): InstallationTokenError {
  return {
    code: 'rate_limited',
    message: `Installation ${installationId} is rate limited. Retry after ${retryAfterSeconds}s`,
    installationId,
    retryAfterSeconds,
    isSecondaryLimit,
  };
}

/**
 * Create a generic installation token error.
 *
 * Utility for creating errors with specific codes.
 */
export function createInstallationTokenError(
  code: InstallationTokenErrorCode,
  installationId: number,
  message: string,
): InstallationTokenError {
  return {
    code,
    message,
    installationId,
  };
}
