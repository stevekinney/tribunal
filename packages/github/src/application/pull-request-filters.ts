/**
 * Default filters for project-level pull request aggregation.
 *
 * Shared between the web app and workers so both sides
 * use identical paging / sorting defaults.
 */

export interface ProjectPullRequestFilters {
  state: 'open' | 'closed' | 'all';
  sort: 'created' | 'updated' | 'popularity' | 'long-running';
  direction: 'asc' | 'desc';
  repositoryIds?: number[];
  perPage: number;
  maxTotal: number;
}

export const DEFAULT_PROJECT_PR_FILTERS: ProjectPullRequestFilters = {
  state: 'open',
  sort: 'updated',
  direction: 'desc',
  perPage: 30,
  maxTotal: 100,
};
