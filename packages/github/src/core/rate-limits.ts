/**
 * Redis-based rate limit tracking for GitHub installations.
 *
 * Tracks rate limit state per installation to enable:
 * - Preemptive rate limit checking before API calls
 * - Proper retry timing in Temporal workflows
 * - Visibility into rate limit state across requests
 *
 * Design decisions:
 * - Fail open: If Redis unavailable, return { limited: false } to allow requests
 * - Last-write-wins: Concurrent updates are acceptable for rate limit tracking
 * - TTL: 1 hour (matches typical GitHub rate limit window)
 */

import type { GithubServiceContext } from '../context.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Rate limit state stored in Redis.
 */
export interface RateLimitState {
  /** Requests remaining until limit reset */
  remaining: number;
  /** Total request limit for the window */
  limit: number;
  /** Unix timestamp (seconds) when limit resets */
  resetAt: number;
  /** Unix timestamp (ms) when this state was last updated */
  lastUpdated: number;
  /** True if this is a secondary/abuse rate limit */
  isSecondaryLimit: boolean;
}

/**
 * Result of checking rate limit state.
 */
export type RateLimitCheckResult =
  | { limited: true; retryAfterSeconds: number; isSecondary: boolean }
  | { limited: false };

// ============================================================================
// Constants
// ============================================================================

const RATE_LIMIT_KEY_PREFIX = 'github-ratelimit:installation:';
const RATE_LIMIT_TTL_SECONDS = 3600; // 1 hour

// ============================================================================
// Key Management
// ============================================================================

/**
 * Generate Redis key for an installation's rate limit state.
 */
function getRateLimitKey(installationId: number): string {
  return `${RATE_LIMIT_KEY_PREFIX}${installationId}`;
}

// ============================================================================
// Rate Limit Operations
// ============================================================================

/**
 * Get current rate limit state for an installation.
 *
 * Returns null if not cached or Redis unavailable (fail open).
 */
export async function getRateLimitState(
  context: GithubServiceContext,
  installationId: number,
): Promise<RateLimitState | null> {
  try {
    return await context.cache.getCached<RateLimitState>(getRateLimitKey(installationId));
  } catch (error) {
    // Fail open - log but don't throw
    console.warn(`Failed to get rate limit state for installation ${installationId}:`, error);
    return null;
  }
}

/**
 * Update rate limit state from GitHub API response headers.
 *
 * Extracts rate limit information from standard GitHub headers:
 * - x-ratelimit-remaining: Requests remaining
 * - x-ratelimit-limit: Total requests allowed
 * - x-ratelimit-reset: Unix timestamp when limit resets
 * - retry-after: Seconds to wait (for 429 responses)
 *
 * @param context - GitHub service dependency injection context
 * @param installationId - The installation to update
 * @param headers - Response headers containing rate limit info
 * @param isSecondaryLimit - True if this update is from a 429 response
 */
export async function updateRateLimitFromHeaders(
  context: GithubServiceContext,
  installationId: number,
  headers: Record<string, string | undefined>,
  isSecondaryLimit: boolean = false,
): Promise<void> {
  try {
    // Parse rate limit headers (case-insensitive lookup)
    const remaining = parseHeader(headers, 'x-ratelimit-remaining');
    const limit = parseHeader(headers, 'x-ratelimit-limit');
    const resetAt = parseHeader(headers, 'x-ratelimit-reset');
    const retryAfter = parseHeader(headers, 'retry-after');

    // Need at least remaining and reset to store useful state
    if (remaining === null || resetAt === null) {
      // For secondary rate limits with retry-after, we can still store state
      if (isSecondaryLimit && retryAfter !== null) {
        const state: RateLimitState = {
          remaining: 0,
          limit: limit ?? 5000, // Default GitHub API limit
          resetAt: Math.floor(Date.now() / 1000) + retryAfter,
          lastUpdated: Date.now(),
          isSecondaryLimit: true,
        };
        await context.cache.setCache(
          getRateLimitKey(installationId),
          state,
          RATE_LIMIT_TTL_SECONDS,
        );
      }
      return;
    }

    const state: RateLimitState = {
      remaining,
      limit: limit ?? 5000,
      resetAt,
      lastUpdated: Date.now(),
      isSecondaryLimit,
    };

    await context.cache.setCache(getRateLimitKey(installationId), state, RATE_LIMIT_TTL_SECONDS);
  } catch (error) {
    // Fail open - log but don't throw
    console.warn(`Failed to update rate limit state for installation ${installationId}:`, error);
  }
}

/**
 * Check if an installation is currently rate limited.
 *
 * Returns time until reset if limited, null otherwise.
 * Fails open: returns { limited: false } if Redis unavailable.
 */
export async function checkRateLimitState(
  context: GithubServiceContext,
  installationId: number,
): Promise<RateLimitCheckResult> {
  try {
    const state = await getRateLimitState(context, installationId);

    if (!state) {
      return { limited: false }; // No cached state - allow request
    }

    const now = Math.floor(Date.now() / 1000);

    // Check if limit has reset
    if (state.resetAt <= now) {
      return { limited: false };
    }

    // Check if we're at or below the limit
    if (state.remaining <= 0) {
      return {
        limited: true,
        retryAfterSeconds: Math.max(1, state.resetAt - now),
        isSecondary: state.isSecondaryLimit,
      };
    }

    return { limited: false };
  } catch (error) {
    // Fail open - log but return not limited
    console.warn(`Failed to check rate limit state for installation ${installationId}:`, error);
    return { limited: false };
  }
}

/**
 * Clear rate limit state for an installation.
 *
 * Used when:
 * - Installation is deleted
 * - Rate limit state should be reset manually
 * - Testing
 */
export async function clearRateLimitState(
  context: GithubServiceContext,
  installationId: number,
): Promise<void> {
  try {
    await context.cache.deleteCache(getRateLimitKey(installationId));
  } catch (error) {
    // Log but don't throw - clearing is best effort
    console.warn(`Failed to clear rate limit state for installation ${installationId}:`, error);
  }
}

/**
 * Decrement the remaining count without making an API call.
 *
 * Used when we know we're about to make a request and want to
 * proactively decrement the counter.
 *
 * Note: This uses read-modify-write without atomicity. Concurrent requests
 * may read the same `remaining` value before either writes, causing the
 * counter to decrement by 1 instead of N. This is an acceptable trade-off
 * for rate limit tracking (see design decision: "Last-write-wins").
 */
export async function decrementRateLimitRemaining(
  context: GithubServiceContext,
  installationId: number,
): Promise<void> {
  try {
    const state = await getRateLimitState(context, installationId);
    if (!state || state.remaining <= 0) return;

    const updatedState: RateLimitState = {
      ...state,
      remaining: state.remaining - 1,
      lastUpdated: Date.now(),
    };

    await context.cache.setCache(
      getRateLimitKey(installationId),
      updatedState,
      RATE_LIMIT_TTL_SECONDS,
    );
  } catch (error) {
    // Fail open - log but don't throw
    console.warn(
      `Failed to decrement rate limit remaining for installation ${installationId}:`,
      error,
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get a header value with case-insensitive lookup.
 *
 * Octokit response headers may preserve GitHub's original casing
 * (e.g., 'X-RateLimit-Remaining' vs 'x-ratelimit-remaining').
 * This helper checks both lowercase and original case.
 */
function getHeader(headers: Record<string, string | undefined>, name: string): string | undefined {
  const normalizedName = name.toLowerCase();
  const directMatch = headers[normalizedName];
  if (directMatch !== undefined) return directMatch;

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) {
      return value;
    }
  }

  return undefined;
}

/**
 * Parse a header value as an integer using case-insensitive lookup.
 * Returns null if the header is missing or not a valid number.
 */
function parseHeader(headers: Record<string, string | undefined>, name: string): number | null {
  const value = getHeader(headers, name);
  if (value === undefined || value === null) return null;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Check if a response indicates a secondary rate limit.
 *
 * GitHub uses different mechanisms for primary vs secondary limits:
 * - Primary: 403 with x-ratelimit-remaining: 0
 * - Secondary (abuse): 429 with retry-after header
 */
export function isSecondaryRateLimit(
  status: number,
  headers: Record<string, string | undefined>,
): boolean {
  // 429 is always secondary
  if (status === 429) return true;

  // 403 with retry-after is also secondary (case-insensitive lookup)
  if (status === 403 && getHeader(headers, 'retry-after')) return true;

  return false;
}
