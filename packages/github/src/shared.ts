/**
 * Shared GitHub API types and transformations.
 *
 * Contains common types and utility functions used across GitHub API modules.
 */

// ============================================================================
// Common types
// ============================================================================

/**
 * Sort direction used across GitHub API endpoints.
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Minimal GitHub user type that covers all API response shapes.
 * The GitHub API returns user objects with at least these fields.
 */
export interface GitHubUser {
  login: string;
  avatar_url?: string | null;
  html_url: string;
}

/**
 * Transformed author representation used across the application.
 */
export interface Author {
  login: string;
  avatarUrl: string | null;
  htmlUrl: string;
}

// ============================================================================
// Transformations
// ============================================================================

/**
 * Transform a GitHub API user object to our normalized Author type.
 *
 * This is the single source of truth for author transformation across
 * all GitHub API modules (pull requests, review comments, etc.).
 *
 * @param user - GitHub user object from any API endpoint, or null
 * @returns Normalized Author object, or null if input is null/undefined
 */
export function transformAuthor(user: GitHubUser | null | undefined): Author | null {
  if (!user) return null;
  return {
    login: user.login,
    avatarUrl: user.avatar_url ?? null,
    htmlUrl: user.html_url,
  };
}

// ============================================================================
// Caching utilities
// ============================================================================

/** TTL for GitHub list endpoint Redis caches (seconds). */
export const GITHUB_LIST_CACHE_TTL = 60;

/** TTL for GitHub API response Redis caches (seconds). */
export const GITHUB_RESPONSE_CACHE_TTL_SECONDS = 5;

/**
 * Encode a user-supplied filter value for use in cache keys.
 * Escapes `%`, `|`, and `:` to prevent delimiter collisions.
 * `%` is escaped first to avoid double-encoding.
 */
export function encodeFilterValue(value: string): string {
  return value.replace(/%/g, '%25').replace(/[|:]/g, (ch) => `%${ch.charCodeAt(0).toString(16)}`);
}
