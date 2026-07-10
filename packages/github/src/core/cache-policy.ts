/**
 * Cache policy registry for GitHub API endpoints.
 *
 * Centralizes TTL values, cache key factories, and eTag support flags
 * that were previously scattered across service files. Each policy maps
 * an operationId to its caching configuration.
 */

import { CACHE_KEYS } from '../cache-keys.js';
import { GITHUB_LIST_CACHE_TTL, GITHUB_RESPONSE_CACHE_TTL_SECONDS } from '@tribunal/github/shared';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for how a specific GitHub API operation should be cached.
 */
export interface CachePolicy<TArgs extends unknown[] = unknown[]> {
  /** Unique identifier for the operation (used in logging and registry lookup). */
  operationId: string;

  /**
   * Factory function that builds a Redis cache key from operation-specific arguments.
   * Arguments vary per operation (e.g., owner/repo/number for PR detail).
   */
  keyFactory: (...args: TArgs) => string;

  /** Time-to-live in seconds for successful responses. */
  ttlSeconds: number;

  /** Whether this REST endpoint returns eTag headers for conditional requests. */
  supportsEtag: boolean;
}

// ============================================================================
// Registry
// ============================================================================

/**
 * Registry of cache policies keyed by operationId.
 *
 * Use `registerPolicy()` to add entries and `getPolicy()` to look them up.
 * All policies should be registered at module load time.
 */
const registry = new Map<string, CachePolicy<unknown[]>>();

/** Register a cache policy. Throws if the operationId is already registered. */
export function registerPolicy<TArgs extends unknown[]>(policy: CachePolicy<TArgs>): void {
  if (registry.has(policy.operationId)) {
    throw new Error(`Cache policy already registered for operationId: ${policy.operationId}`);
  }
  registry.set(policy.operationId, policy as CachePolicy<unknown[]>);
}

/** Look up a cache policy by operationId. Returns undefined if not found. */
export function getPolicy(operationId: string): CachePolicy<unknown[]> | undefined {
  return registry.get(operationId);
}

/**
 * Look up a cache policy by operationId, throwing if not found.
 * Prefer this over `getPolicy()!` at call sites for descriptive errors.
 */
export function requirePolicy(operationId: string): CachePolicy<unknown[]> {
  const policy = registry.get(operationId);
  if (!policy) {
    throw new Error(`Cache policy "${operationId}" not found — was cache-policy.ts imported?`);
  }
  return policy;
}

/** Get all registered policies. Useful for testing and auditing. */
export function getAllPolicies(): ReadonlyMap<string, CachePolicy<unknown[]>> {
  return registry;
}

// ============================================================================
// Registered policies — pull requests
// ============================================================================

registerPolicy({
  operationId: 'list-pull-requests',
  keyFactory: (repositoryId: number, filterKey: string) =>
    CACHE_KEYS.GITHUB_PRS_LIST(repositoryId, filterKey),
  ttlSeconds: GITHUB_LIST_CACHE_TTL,
  supportsEtag: false, // List fetch callbacks do not forward eTag headers
});

registerPolicy({
  operationId: 'get-pull-request',
  keyFactory: (owner: string, repo: string, pullNumber: number) =>
    CACHE_KEYS.GITHUB_PR_DETAIL(owner, repo, pullNumber),
  ttlSeconds: GITHUB_RESPONSE_CACHE_TTL_SECONDS,
  supportsEtag: true,
});

registerPolicy({
  operationId: 'get-pull-request-diff-context',
  keyFactory: (repositoryId: number, pullNumber: number, headSha: string) =>
    CACHE_KEYS.GITHUB_PR_DIFF_CONTEXT(repositoryId, pullNumber, headSha),
  ttlSeconds: 30,
  supportsEtag: false,
});

registerPolicy({
  operationId: 'mint-single-repository-read-token',
  keyFactory: (installationId: number, repositoryId: number) =>
    CACHE_KEYS.GITHUB_SINGLE_REPOSITORY_READ_TOKEN(installationId, repositoryId),
  ttlSeconds: 55 * 60,
  supportsEtag: false,
});

// ============================================================================
// Registered policies — issues
// ============================================================================

registerPolicy({
  operationId: 'list-issues',
  keyFactory: (repositoryId: number, filterKey: string) =>
    CACHE_KEYS.GITHUB_ISSUES_LIST(repositoryId, filterKey),
  ttlSeconds: GITHUB_LIST_CACHE_TTL,
  supportsEtag: false, // List fetch callbacks do not forward eTag headers
});

registerPolicy({
  operationId: 'get-issue',
  keyFactory: (owner: string, repo: string, issueNumber: number) =>
    CACHE_KEYS.GITHUB_ISSUE_DETAIL(owner, repo, issueNumber),
  ttlSeconds: GITHUB_RESPONSE_CACHE_TTL_SECONDS,
  supportsEtag: true,
});

registerPolicy({
  operationId: 'list-issue-comments',
  keyFactory: (owner: string, repo: string, issueNumber: number, filterKey: string) =>
    CACHE_KEYS.GITHUB_ISSUE_COMMENTS_LIST(owner, repo, issueNumber, filterKey),
  ttlSeconds: GITHUB_RESPONSE_CACHE_TTL_SECONDS,
  supportsEtag: true,
});

// ============================================================================
// Registered policies — review comments and threads
// ============================================================================

registerPolicy({
  operationId: 'list-review-comments',
  keyFactory: (owner: string, repo: string, pullNumber: number, filterKey: string) =>
    CACHE_KEYS.GITHUB_REVIEW_COMMENTS_LIST(owner, repo, pullNumber, filterKey),
  ttlSeconds: GITHUB_RESPONSE_CACHE_TTL_SECONDS,
  supportsEtag: true,
});

registerPolicy({
  operationId: 'validate-thread-ownership',
  keyFactory: (threadId: string, expectedOwner: string, expectedRepo: string) =>
    CACHE_KEYS.GITHUB_REVIEW_THREAD_VALIDATE(threadId, expectedOwner, expectedRepo),
  ttlSeconds: GITHUB_RESPONSE_CACHE_TTL_SECONDS,
  supportsEtag: false, // GraphQL — no eTag support
});

registerPolicy({
  operationId: 'find-thread-for-comment',
  keyFactory: (owner: string, repo: string, prNumber: number, commentNodeId: string) =>
    CACHE_KEYS.GITHUB_REVIEW_THREAD_LOOKUP(owner, repo, prNumber, commentNodeId),
  ttlSeconds: GITHUB_RESPONSE_CACHE_TTL_SECONDS,
  supportsEtag: false, // GraphQL — no eTag support
});

// ============================================================================
// Registered policies — repositories
// ============================================================================

registerPolicy({
  operationId: 'get-installation',
  keyFactory: (installationId: number) => CACHE_KEYS.GITHUB_INSTALLATION_DETAIL(installationId),
  ttlSeconds: GITHUB_RESPONSE_CACHE_TTL_SECONDS,
  supportsEtag: true,
});

registerPolicy({
  operationId: 'list-installation-repositories',
  keyFactory: (installationId: number) =>
    CACHE_KEYS.GITHUB_INSTALLATION_REPOSITORIES(installationId),
  ttlSeconds: GITHUB_RESPONSE_CACHE_TTL_SECONDS,
  supportsEtag: false, // Uses octokit.paginate which aggregates multiple pages — no single eTag
});

// ============================================================================
// Registered policies — review state and CI (previously uncached)
// ============================================================================

registerPolicy({
  operationId: 'get-aggregate-review-state',
  keyFactory: (owner: string, repo: string, prNumber: number) =>
    CACHE_KEYS.GITHUB_REVIEW_STATE(owner, repo, prNumber),
  ttlSeconds: 30, // Short TTL — review state changes frequently
  supportsEtag: false, // Multi-call aggregation, no single eTag
});

registerPolicy({
  operationId: 'get-review-thread-counts',
  keyFactory: (owner: string, repo: string, prNumber: number) =>
    CACHE_KEYS.GITHUB_REVIEW_THREAD_COUNTS(owner, repo, prNumber),
  ttlSeconds: 30, // Short TTL — review threads change frequently
  supportsEtag: false, // GraphQL — no eTag support
});

registerPolicy({
  operationId: 'get-failing-check-count',
  keyFactory: (owner: string, repo: string, headSha: string) =>
    CACHE_KEYS.GITHUB_CHECK_COUNTS(owner, repo, headSha),
  ttlSeconds: 30, // Short TTL — CI status changes frequently
  supportsEtag: false, // Multi-page aggregation, no single eTag
});

// ============================================================================
// Registered policies — worker activities
// ============================================================================

registerPolicy({
  operationId: 'worker-aggregate-pull-requests',
  keyFactory: (repositoryId: number, filterKey: string) =>
    CACHE_KEYS.GITHUB_WORKER_AGGREGATE_PRS(repositoryId, filterKey),
  ttlSeconds: 30, // Short TTL — workers repeat across projects
  supportsEtag: false, // List fetch callbacks do not forward eTag headers
});

// ============================================================================
// Registered policies — app configuration
// ============================================================================

registerPolicy({
  operationId: 'get-app-webhook-configuration',
  keyFactory: () => CACHE_KEYS.GITHUB_APP_WEBHOOK_CONFIGURATION,
  ttlSeconds: 86400,
  supportsEtag: true,
});

// ============================================================================
// Registered policies — branch CI
// ============================================================================

registerPolicy({
  operationId: 'get-branch-ci-status',
  keyFactory: (owner: string, repo: string, branch: string) =>
    CACHE_KEYS.GITHUB_BRANCH_CI_STATUS(owner, repo, branch),
  ttlSeconds: 30, // Short TTL — branch CI changes frequently
  supportsEtag: false, // GraphQL — no eTag support
});

registerPolicy({
  operationId: 'get-branch-head-sha',
  keyFactory: (owner: string, repo: string, branch: string) =>
    CACHE_KEYS.GITHUB_BRANCH_HEAD_SHA(owner, repo, branch),
  ttlSeconds: 30, // Short TTL — a branch can move at any time via push
  supportsEtag: false, // repos.getBranch — no conditional-request support wired here
});
