/**
 * Shared GitHub API error handling utilities.
 *
 * Provides type guards and helpers for handling both REST and GraphQL errors
 * from the GitHub API. Used by service modules and server endpoints.
 */

// ============================================================================
// HTTP Header Utilities
// ============================================================================

/**
 * Get an HTTP header value with case-insensitive lookup.
 *
 * HTTP headers are case-insensitive, but Octokit may preserve original casing
 * (e.g., `Retry-After` vs `retry-after`). This helper ensures reliable lookups.
 *
 * @param headers - Headers object from error.response.headers
 * @param name - Header name (case-insensitive)
 * @returns Header value if found, undefined otherwise
 */
export function getHeader(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;

  const normalizedName = name.toLowerCase();

  // Try direct match first (common case)
  const directMatch = headers[normalizedName];
  if (directMatch !== undefined) return directMatch;

  // Fall back to case-insensitive search
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) {
      return value;
    }
  }

  return undefined;
}

// ============================================================================
// REST API Error Types
// ============================================================================

/**
 * Extended Error type for Octokit REST API errors.
 * Octokit throws errors with status codes and response data.
 */
export interface OctokitRequestError extends Error {
  status: number;
  response?: {
    data?: {
      message?: string;
      errors?: Array<{ message: string; resource?: string; field?: string; code?: string }>;
      documentation_url?: string;
    };
    headers?: Record<string, string>;
  };
}

/**
 * Type guard to check if an error is an Octokit REST API error.
 */
export function isOctokitRequestError(error: unknown): error is OctokitRequestError {
  return (
    error instanceof Error &&
    'status' in error &&
    typeof (error as OctokitRequestError).status === 'number'
  );
}

/**
 * Check if an error is a GitHub rate limit error.
 * Handles both primary (403 with rate limit headers) and secondary (429) rate limits.
 */
export function isRateLimitError(error: unknown): boolean {
  if (!isOctokitRequestError(error)) return false;

  // Secondary rate limit (abuse detection)
  if (error.status === 429) return true;

  // Primary rate limit (X-RateLimit-Remaining: 0)
  if (error.status === 403) {
    const message = error.response?.data?.message ?? '';
    return message.toLowerCase().includes('rate limit');
  }

  return false;
}

/**
 * Check if an error is a GitHub 304 Not Modified response.
 * Octokit throws on 304 when using conditional requests (If-None-Match).
 */
export function isNotModifiedError(error: unknown): boolean {
  return isOctokitRequestError(error) && error.status === 304;
}

/**
 * Check if an error is a GitHub not found error.
 */
export function isNotFoundError(error: unknown): boolean {
  return isOctokitRequestError(error) && error.status === 404;
}

/**
 * Check if an error is a GitHub validation error (422).
 */
export function isValidationError(error: unknown): boolean {
  return isOctokitRequestError(error) && error.status === 422;
}

/**
 * Check if an error is a GitHub forbidden error (403).
 * Note: Rate limit errors also return 403, use isRateLimitError first.
 */
export function isForbiddenError(error: unknown): boolean {
  if (!isOctokitRequestError(error)) return false;
  if (error.status !== 403) return false;
  // Exclude rate limit errors
  return !isRateLimitError(error);
}

/**
 * Check if an error is a GitHub unauthorized error (401).
 * Usually indicates an invalid or expired token.
 */
export function isUnauthorizedError(error: unknown): boolean {
  return isOctokitRequestError(error) && error.status === 401;
}

/**
 * Extract the error message from an Octokit error.
 */
export function getErrorMessage(error: unknown): string {
  if (isOctokitRequestError(error)) {
    return error.response?.data?.message ?? error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

/**
 * Extract rate limit retry-after value in seconds.
 * Returns null if not a rate limit error or header is missing.
 */
export function getRateLimitRetryAfter(error: unknown): number | null {
  if (!isOctokitRequestError(error)) return null;

  // Check Retry-After header (429 responses and some 403s)
  const retryAfter = getHeader(error.response?.headers, 'retry-after');
  if (retryAfter) {
    const parsed = parseInt(retryAfter, 10);
    if (!isNaN(parsed)) return parsed;
  }

  // Check X-RateLimit-Reset header (403 rate limit responses)
  const resetTimestamp = getHeader(error.response?.headers, 'x-ratelimit-reset');
  if (resetTimestamp) {
    const resetAt = parseInt(resetTimestamp, 10);
    if (!isNaN(resetAt)) {
      return Math.max(0, resetAt - Math.floor(Date.now() / 1000));
    }
  }

  return null;
}

// ============================================================================
// GraphQL Error Types
// ============================================================================

/**
 * GraphQL error structure from GitHub's GraphQL API.
 */
export interface GraphQLError {
  message: string;
  type?: string;
  path?: string[];
  locations?: Array<{ line: number; column: number }>;
  extensions?: Record<string, unknown>;
}

/**
 * Error thrown by Octokit's graphql() method.
 */
export interface GraphQLResponseError extends Error {
  errors?: GraphQLError[];
  data?: unknown;
  headers?: Record<string, string>;
}

/**
 * Type guard to check if an error is a GraphQL response error.
 */
export function isGraphQLResponseError(error: unknown): error is GraphQLResponseError {
  return (
    error instanceof Error &&
    'errors' in error &&
    Array.isArray((error as GraphQLResponseError).errors)
  );
}

/**
 * Extract GraphQL errors from an error object.
 * Returns null if not a GraphQL error.
 */
export function extractGraphQLErrors(error: unknown): GraphQLError[] | null {
  if (isGraphQLResponseError(error) && error.errors) {
    return error.errors;
  }
  return null;
}

/**
 * Check if a GraphQL error indicates a NOT_FOUND error.
 */
export function isGraphQLNotFoundError(errors: GraphQLError[]): boolean {
  return errors.some(
    (e) =>
      e.type === 'NOT_FOUND' ||
      e.message.toLowerCase().includes('not found') ||
      e.message.toLowerCase().includes('could not resolve'),
  );
}

/**
 * Check if a GraphQL error indicates insufficient permissions.
 */
export function isGraphQLForbiddenError(errors: GraphQLError[]): boolean {
  return errors.some(
    (e) =>
      e.type === 'FORBIDDEN' ||
      e.type === 'INSUFFICIENT_SCOPES' ||
      e.message.toLowerCase().includes('permission') ||
      e.message.toLowerCase().includes('forbidden'),
  );
}

/**
 * Check if a GraphQL error indicates a rate limit.
 */
export function isGraphQLRateLimitError(errors: GraphQLError[]): boolean {
  return errors.some(
    (e) => e.type === 'RATE_LIMITED' || e.message.toLowerCase().includes('rate limit'),
  );
}

/**
 * Get the first error message from GraphQL errors.
 */
export function getGraphQLErrorMessage(errors: GraphQLError[]): string {
  return errors[0]?.message ?? 'GraphQL error';
}

// ============================================================================
// Validation Error Details
// ============================================================================

/**
 * Common GitHub validation error reasons for write operations.
 */
export type ValidationErrorReason =
  | 'stale_diff' // Comment on outdated commit
  | 'invalid_position' // Line not part of diff
  | 'pr_closed' // PR is closed/merged
  | 'self_review' // Author cannot be reviewer
  | 'user_not_found' // Reviewer doesn't exist
  | 'team_not_found' // Team doesn't exist
  | 'no_access' // User/team lacks repo access
  | 'already_exists' // Resource already exists
  | 'unknown';

/**
 * Parse validation error reason from a 422 error message.
 */
export function parseValidationErrorReason(error: unknown): ValidationErrorReason {
  if (!isValidationError(error)) return 'unknown';

  const message = getErrorMessage(error).toLowerCase();

  if (message.includes('commit_id') || message.includes('outdated')) {
    return 'stale_diff';
  }
  if (message.includes('line') && message.includes('diff')) {
    return 'invalid_position';
  }
  if (message.includes('closed') || message.includes('merged')) {
    return 'pr_closed';
  }
  if (message.includes('author') && (message.includes('reviewer') || message.includes('review'))) {
    return 'self_review';
  }
  if (message.includes('user') && message.includes('not found')) {
    return 'user_not_found';
  }
  if (message.includes('team') && message.includes('not found')) {
    return 'team_not_found';
  }
  if (message.includes('access') || message.includes('permission')) {
    return 'no_access';
  }
  if (message.includes('already')) {
    return 'already_exists';
  }

  return 'unknown';
}
