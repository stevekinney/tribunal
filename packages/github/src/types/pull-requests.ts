/**
 * Pull request display types.
 *
 * Pure type definitions for PR data used across client and server.
 * No runtime dependencies beyond the shared Author type.
 */
import type { Author, SortDirection } from '../shared.js';

export type PullRequestFilterState = 'open' | 'closed' | 'all';
export type PullRequestSort = 'created' | 'updated' | 'popularity' | 'long-running';

export interface PullRequestFilterOptions {
  state: PullRequestFilterState;
  sort: PullRequestSort;
  direction: SortDirection;
  head?: string;
  base?: string;
  page: number;
  perPage: number;
}

/** @see Author - Uses shared author type for consistency */
export type PullRequestAuthor = Author;

export interface PullRequestLabel {
  name: string;
  color: string;
  description: string | null;
}

export interface PullRequestListItem {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  locked: boolean;
  author: PullRequestAuthor | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  labels: PullRequestLabel[];
  headRef: string;
  headSha: string;
  baseRef: string;
  htmlUrl: string;
}

export interface PullRequestDetail extends PullRequestListItem {
  body: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: boolean | null;
  mergeableState: string;
  merged: boolean;
  mergedBy: PullRequestAuthor | null;
  comments: number;
  reviewComments: number;
  commits: number;
}

export interface PullRequestListResult {
  pullRequests: PullRequestListItem[];
  filters: PullRequestFilterOptions;
  /**
   * Whether a next page is available. Derived from GitHub's `Link` response
   * header (`rel="next"`) when present, falling back to a full-page
   * row-count heuristic only when the header is missing.
   */
  hasNextPage: boolean;
}

export type PullRequestCiStatus = 'passing' | 'failing' | 'pending' | 'unknown';
export type PullRequestMergeConflictStatus = 'clean' | 'conflicting' | 'unknown';

export interface PullRequestOperationalStatus {
  ciStatus: PullRequestCiStatus;
  checkCount: number;
  resolvedReviewThreadCount: number | null;
  unresolvedReviewThreadCount: number | null;
  mergeConflictStatus: PullRequestMergeConflictStatus;
  mergeableState: string | null;
}
