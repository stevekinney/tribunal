/**
 * Shared repository and pull request identity types.
 *
 * These types define the minimal shapes used across the web app,
 * workers, and domain logic (dependency graphs, summaries).
 */

// ============================================================================
// Repository Context
// ============================================================================

/**
 * Minimal repository info attached to aggregated items.
 *
 * Used by pull request aggregation, issue aggregation, dependency graphs,
 * and error reporting across both the web app and workers.
 */
export interface RepositoryContext {
  id: number;
  owner: string;
  name: string;
}

// ============================================================================
// Pull Request Identity
// ============================================================================

/**
 * Minimal pull request shape shared between workers and domain logic.
 *
 * Workers produce this shape from GitHub API responses. The web app's
 * `AggregatedPullRequest` is a superset (extending `PullRequestListItem`),
 * but this captures the fields needed for cross-cutting concerns like
 * dependency analysis and activity feeds.
 */
export interface PullRequestIdentity {
  number: number;
  title: string;
  headRef: string;
  baseRef: string;
  labels: string[];
  draft: boolean;
  authorLogin: string | null;
  createdAt: string;
  updatedAt: string;
  repository: RepositoryContext;
}
