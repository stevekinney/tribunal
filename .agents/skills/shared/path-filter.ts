/**
 * Shared path exclusion utilities for skill scripts.
 *
 * Provides consistent filtering logic to exclude build artifacts,
 * dependency directories, and other non-documentation paths.
 */

export const EXCLUDED_PATH_SEGMENTS = [
  '/.git/',
  '/.turbo/',
  '/.vercel/',
  '/node_modules/',
  '/tmp/',
  '/worktrees/',
] as const;

/**
 * Checks whether a path should be included based on exclusion list.
 *
 * @param path - Path to check (relative or absolute)
 * @returns true if the path does not contain any excluded segments
 */
export function isIncludedPath(path: string): boolean {
  const normalizedPath = `/${path}`;
  return !EXCLUDED_PATH_SEGMENTS.some((segment) => normalizedPath.includes(segment));
}
