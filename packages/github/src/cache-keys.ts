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
  //
  // Partitioned by installation for the same reason as GITHUB_PRS_LIST below:
  // `cachedRead` answers a hit without invoking the Octokit client, so the
  // credential that would have been access-checked is never used, and a
  // repository carrying link rows for two installations would otherwise serve
  // one installation's private issue list to the other. Always the
  // installation whose credentials authenticated the fetch.
  GITHUB_ISSUES_LIST: (repositoryId: number, installationId: number, filterKey: string) =>
    `github:repository:${repositoryId}:issues:list:installation:${installationId}:${filterKey}`,
  GITHUB_ISSUES_LIST_PATTERN: (repositoryId: number) =>
    `github:repository:${repositoryId}:issues:list:*`,

  // GitHub PRs list (Redis)
  //
  // `installationId` is part of the key because `cachedRead` answers a hit
  // without invoking the Octokit client, so the credential that would have
  // been access-checked is never used. A repository can carry link rows for
  // more than one installation (a transfer that leaves the old row behind),
  // and without this segment the first installation to populate an entry
  // serves its content to every other one. Always the installation whose
  // credentials authenticated the fetch — never a repository's "primary".
  GITHUB_PRS_LIST: (repositoryId: number, installationId: number, filterKey: string) =>
    `github:repository:${repositoryId}:prs:list:installation:${installationId}:${filterKey}`,
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

  // Installation is a trailing segment rather than a prefix so the existing
  // `github:response:{owner}:{repo}:pr:{n}:*` sweeps keep matching. See
  // GITHUB_PRS_LIST above for why these are partitioned at all.
  GITHUB_PR_DETAIL: (owner: string, repo: string, pullNumber: number, installationId: number) =>
    `github:response:${owner}:${repo}:pr:${pullNumber}:installation:${installationId}`,
  GITHUB_PR_DETAIL_PATTERN: (owner: string, repo: string, pullNumber: number) =>
    `github:response:${owner}:${repo}:pr:${pullNumber}:installation:*`,
  GITHUB_PR_METADATA: (owner: string, repo: string, pullNumber: number, installationId: number) =>
    `github:response:${owner}:${repo}:pr:${pullNumber}:metadata:installation:${installationId}`,
  GITHUB_PR_METADATA_PATTERN: (owner: string, repo: string, pullNumber: number) =>
    `github:response:${owner}:${repo}:pr:${pullNumber}:metadata:installation:*`,
  // Installation is a trailing segment for the same reason as GITHUB_PR_DETAIL
  // above — `cachedRead` answers a hit without invoking the Octokit client,
  // so without this a repository carrying link rows for two installations
  // (a transfer leaves the old row behind) would let one installation's
  // fetched diff context leak to the other.
  GITHUB_PR_DIFF_CONTEXT: (
    repositoryId: number,
    pullNumber: number,
    headSha: string,
    installationId: number,
  ) =>
    `github:response:repository:${repositoryId}:pr:${pullNumber}:head:${headSha}:diff-context:installation:${installationId}`,

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

  // GitHub `GET /user/installations` — the installations a user's own OAuth
  // token can see. Keyed by user, not installation, because it authorizes a
  // person, not a repository.
  GITHUB_USER_INSTALLATIONS: (userId: number) => `github:response:user:${userId}:installations`,
  // No per-user pattern here: an `installation` lifecycle webhook carries an
  // installation id, not the set of local user ids who might have that
  // installation cached. Invalidation clears every cached user's list rather
  // than trying (and failing) to target just the affected one — see
  // `webhooks/resource-invalidation.ts`.
  GITHUB_USER_INSTALLATIONS_PATTERN: 'github:response:user:*:installations',

  // GitHub review thread and CI check caches (Redis)
  //
  // Installation is a trailing segment rather than a prefix — same rationale
  // as GITHUB_PR_DETAIL above — so the existing `github:response:{owner}:{repo}:pr:{n}:*`
  // sweep (GITHUB_RESPONSE_PR_PATTERN) keeps matching this entry.
  GITHUB_REVIEW_THREAD_COUNTS: (
    owner: string,
    repo: string,
    prNumber: number,
    installationId: number,
  ) =>
    `github:response:${owner}:${repo}:pr:${prNumber}:review-thread-counts:installation:${installationId}`,
  GITHUB_UNRESOLVED_REVIEW_THREAD_COUNT: (owner: string, repo: string, prNumber: number) =>
    `github:response:${owner}:${repo}:pr:${prNumber}:unresolved-review-thread-count`,
  // Installation is a trailing segment so the exact-key invalidation sites in
  // resource-invalidation.ts move to `deleteCacheByPattern` against
  // GITHUB_CHECK_COUNTS_PATTERN rather than needing to know the installation
  // id that populated the entry.
  GITHUB_CHECK_COUNTS: (owner: string, repo: string, headSha: string, installationId: number) =>
    `github:response:${owner}:${repo}:checks:${headSha}:installation:${installationId}`,
  GITHUB_CHECK_COUNTS_PATTERN: (owner: string, repo: string, headSha: string) =>
    `github:response:${owner}:${repo}:checks:${headSha}:installation:*`,
  GITHUB_BRANCH_CI_STATUS: (owner: string, repo: string, branch: string, installationId: number) =>
    `github:response:${owner}:${repo}:branch:${branch}:ci-status:installation:${installationId}`,
  GITHUB_BRANCH_CI_STATUS_PATTERN: (owner: string, repo: string, branch: string) =>
    `github:response:${owner}:${repo}:branch:${branch}:ci-status:installation:*`,
  GITHUB_BRANCH_HEAD_SHA: (owner: string, repo: string, branch: string, installationId: number) =>
    `github:response:${owner}:${repo}:branch:${branch}:head-sha:installation:${installationId}`,
  GITHUB_BRANCH_HEAD_SHA_PATTERN: (owner: string, repo: string, branch: string) =>
    `github:response:${owner}:${repo}:branch:${branch}:head-sha:installation:*`,
  GITHUB_BRANCH_RULES: (owner: string, repo: string, branch: string, installationId: number) =>
    `github:response:${owner}:${repo}:branch:${branch}:rules:installation:${installationId}`,
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
