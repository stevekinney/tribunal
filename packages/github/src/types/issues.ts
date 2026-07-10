/**
 * Repository issue display types.
 *
 * Pure type definitions for GitHub issue data used across client and server.
 * No runtime dependencies beyond the shared Author type.
 *
 * These types intentionally exclude anything that would let a GitHub pull
 * request masquerade as an issue — GitHub's `issues.listForRepo` endpoint
 * returns pull requests as issue objects with a `pull_request` key, and
 * callers must filter those rows out before they reach these types.
 */
import type { Author, SortDirection } from '../shared.js';

export type IssueFilterState = 'open' | 'closed' | 'all';
export type IssueSort = 'created' | 'updated' | 'comments';

export interface IssueFilterOptions {
  state: IssueFilterState;
  sort: IssueSort;
  direction: SortDirection;
  assignee?: string;
  creator?: string;
  mentioned?: string;
  labels?: string;
  milestone?: string;
  type?: string;
  page: number;
  perPage: number;
}

/** @see Author - Uses shared author type for consistency */
export type IssueAuthor = Author;

export interface IssueLabel {
  name: string;
  color: string;
  description: string | null;
}

export interface IssueMilestone {
  number: number;
  title: string;
  state: 'open' | 'closed';
  htmlUrl: string;
}

export interface IssueListItem {
  number: number;
  title: string;
  state: 'open' | 'closed';
  author: IssueAuthor | null;
  labels: IssueLabel[];
  assignees: IssueAuthor[];
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  milestone: IssueMilestone | null;
  issueType: string | null;
  htmlUrl: string;
}

export interface IssueListResult {
  issues: IssueListItem[];
  filters: IssueFilterOptions;
  /**
   * Whether a next page is available. Derived solely from GitHub's `Link`
   * response header (`rel="next"`); absent when there is no next page.
   */
  hasNextPage: boolean;
}
