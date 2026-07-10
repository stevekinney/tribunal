/**
 * Cache invalidation keys for SvelteKit's depends/invalidate system.
 * IMPORTANT: Load functions MUST use these exact keys with depends(),
 * and mutations MUST use these exact keys with invalidate().
 */
export const CACHE_KEYS = {
  // GitHub Access (Redis cache for API access checks)
  GITHUB_ACCESS: (userId: number, repositoryId: number) =>
    `github-access:${userId}:${repositoryId}`,
  GITHUB_ACCESS_USER_PATTERN: (userId: number) => `github-access:${userId}:*`,
  GITHUB_ACCESS_REPO_PATTERN: (repositoryId: number) => `github-access:*:${repositoryId}`,

  // GitHub Issues list (Redis)
  GITHUB_ISSUES_LIST: (repositoryId: number, filterKey: string) =>
    `github:repository:${repositoryId}:issues:list:${filterKey}`,
  GITHUB_ISSUES_LIST_PATTERN: (repositoryId: number) =>
    `github:repository:${repositoryId}:issues:list:*`,

  // GitHub PRs list (Redis)
  GITHUB_PRS_LIST: (repositoryId: number, filterKey: string) =>
    `github:repository:${repositoryId}:prs:list:${filterKey}`,
  GITHUB_PRS_LIST_PATTERN: (repositoryId: number) => `github:repository:${repositoryId}:prs:list:*`,

  // GitHub API response caches (Redis)
  GITHUB_ISSUE_DETAIL: (owner: string, repo: string, issueNumber: number) =>
    `github:response:${owner}:${repo}:issue:${issueNumber}`,

  GITHUB_ISSUE_COMMENTS_LIST: (
    owner: string,
    repo: string,
    issueNumber: number,
    filterKey: string,
  ) => `github:response:${owner}:${repo}:issue:${issueNumber}:comments:${filterKey}`,

  GITHUB_PR_DETAIL: (owner: string, repo: string, pullNumber: number) =>
    `github:response:${owner}:${repo}:pr:${pullNumber}`,
  GITHUB_PR_DIFF_CONTEXT: (repositoryId: number, pullNumber: number, headSha: string) =>
    `github:response:repository:${repositoryId}:pr:${pullNumber}:head:${headSha}:diff-context`,

  GITHUB_REVIEW_COMMENTS_LIST: (
    owner: string,
    repo: string,
    pullNumber: number,
    filterKey: string,
  ) => `github:response:${owner}:${repo}:pr:${pullNumber}:review-comments:${filterKey}`,

  GITHUB_REVIEW_THREAD_LOOKUP: (
    owner: string,
    repo: string,
    prNumber: number,
    commentNodeId: string,
  ) => `github:response:${owner}:${repo}:pr:${prNumber}:thread-lookup:${commentNodeId}`,

  GITHUB_REVIEW_THREAD_VALIDATE: (threadId: string, expectedOwner: string, expectedRepo: string) =>
    `github:response:thread:${threadId}:validate:${expectedOwner}:${expectedRepo}`,

  GITHUB_INSTALLATION_DETAIL: (installationId: number) =>
    `github:response:installation:${installationId}:detail`,

  GITHUB_INSTALLATION_REPOSITORIES: (installationId: number) =>
    `github:response:installation:${installationId}:repositories`,

  // GitHub review state and CI check caches (Redis)
  GITHUB_REVIEW_STATE: (owner: string, repo: string, prNumber: number) =>
    `github:response:${owner}:${repo}:pr:${prNumber}:review-state`,
  GITHUB_REVIEW_THREAD_COUNTS: (owner: string, repo: string, prNumber: number) =>
    `github:response:${owner}:${repo}:pr:${prNumber}:review-thread-counts`,
  GITHUB_CHECK_COUNTS: (owner: string, repo: string, headSha: string) =>
    `github:response:${owner}:${repo}:checks:${headSha}`,
  GITHUB_BRANCH_CI_STATUS: (owner: string, repo: string, branch: string) =>
    `github:response:${owner}:${repo}:branch:${branch}:ci-status`,
  GITHUB_BRANCH_HEAD_SHA: (owner: string, repo: string, branch: string) =>
    `github:response:${owner}:${repo}:branch:${branch}:head-sha`,
  GITHUB_SINGLE_REPOSITORY_READ_TOKEN: (installationId: number, repositoryId: number) =>
    `github:installation:${installationId}:repository:${repositoryId}:read-token`,

  // Wildcard patterns for invalidation
  GITHUB_RESPONSE_ISSUE_PATTERN: (owner: string, repo: string, issueNumber: number) =>
    `github:response:${owner}:${repo}:issue:${issueNumber}:*`,
  GITHUB_RESPONSE_PR_PATTERN: (owner: string, repo: string, pullNumber: number) =>
    `github:response:${owner}:${repo}:pr:${pullNumber}:*`,
  GITHUB_RESPONSE_REPO_PATTERN: (owner: string, repo: string) =>
    `github:response:${owner}:${repo}:*`,
  GITHUB_RESPONSE_INSTALLATION_PATTERN: (installationId: number) =>
    `github:response:installation:${installationId}:*`,
  // Worker-specific cache keys (not covered by webhook invalidation — short TTL only)
  GITHUB_WORKER_AGGREGATE_PRS: (repositoryId: number, filterKey: string) =>
    `github:worker:repository:${repositoryId}:prs:${filterKey}`,

  // GitHub App Configuration
  GITHUB_APP_WEBHOOK_CONFIGURATION: 'github:app:webhook-configuration',
} as const;
