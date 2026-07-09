export {
  createGithubApplication,
  createGithubApplicationSingleton,
} from './application/application.js';
export { computeRepositoryUri } from './application/repository-uri.js';
export {
  DEFAULT_PROJECT_PR_FILTERS,
  type ProjectPullRequestFilters,
} from './application/pull-request-filters.js';
export {
  type RepositoryContext,
  type PullRequestIdentity,
} from './application/repository-types.js';

// Core caching abstractions
export {
  type CachePolicy,
  registerPolicy,
  getPolicy,
  requirePolicy,
  getAllPolicies,
} from './core/cache-policy.js';
export {
  cachedRead,
  type CachedReadResult,
  type CachedReadFetchFunction,
  type CachedReadFetchResult,
  type CachedReadOptions,
} from './core/github-read-client.js';

// Dashboard read model
export {
  buildRepositoryDashboard,
  DEFAULT_STALE_AFTER_MS,
  ApiBudget,
  DEFAULT_DASHBOARD_API_BUDGET,
  isAttentionCiStatus,
  isAttentionMergeStatus,
  pullRequestNeedsAttention,
  type BranchCIStatus,
  type DashboardRepositoryIdentity,
  type DashboardPullRequestAuthor,
  type DashboardOptions,
  type DashboardUnavailableReason,
  type PullRequestDashboardRow,
  type RepositoryDashboardRow,
} from './dashboard/service.js';
