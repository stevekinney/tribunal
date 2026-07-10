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

// ============================================================================
// Pagination helpers
// ============================================================================

/**
 * Determine whether another page of REST list results exists.
 *
 * Relies entirely on GitHub's `Link` response header (`rel="next"`). Per
 * GitHub's pagination docs, the header is included whenever another page
 * exists and omitted otherwise — including when the current page happens to
 * contain exactly `perPage` rows but is the last page. A row-count fallback
 * (`rowCount >= perPage`) would misreport `hasNextPage: true` in that exact
 * case, so no such fallback is used: a missing header means there is no next
 * page.
 *
 * @see https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api#using-link-headers
 */
export function resolveHasNextPage(linkHeader: string | undefined): boolean {
  if (!linkHeader) {
    return false;
  }
  return /<[^>]+>;\s*rel="next"/.test(linkHeader);
}
