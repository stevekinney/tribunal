/**
 * GitHub API response cache invalidation for webhook events.
 *
 * Invalidates cached GitHub API responses when the underlying resources change.
 * Follows the same fail-open, never-throw pattern as access-invalidation.ts.
 */

import { CACHE_KEYS } from '../cache-keys.js';
import { getRepositoryByOwnerAndName } from '../repositories/service.js';
import {
  isIssueCommentCreatedEvent,
  isIssueCommentEditedEvent,
  isPullRequestReviewThreadResolvedEvent,
  isPullRequestReviewThreadUnresolvedEvent,
  isCheckRunCompletedEvent,
  isCheckSuiteCompletedEvent,
} from './validate-github-webhook.js';
import type { GithubServiceContext } from '../context.js';
import type { WebhookPayload } from './types.js';

/**
 * Invalidate cached GitHub API responses for a webhook event.
 * Never throws — logs errors and continues.
 */
export async function invalidateGitHubResourceCacheForEvent(
  context: GithubServiceContext,
  eventType: string | null,
  _action: string | null,
  data: WebhookPayload,
): Promise<void> {
  try {
    const repository = data.repository as { owner: { login: string }; name: string } | undefined;

    const owner = repository?.owner?.login;
    const repo = repository?.name;

    switch (eventType) {
      case 'issues':
        if (owner && repo) {
          await invalidateIssueCache(context, owner, repo, data);
        }
        break;

      case 'issue_comment':
        if (owner && repo) {
          await invalidateIssueCommentCache(context, owner, repo, data);
        }
        break;

      case 'pull_request':
        if (owner && repo) {
          await invalidatePullRequestCache(context, owner, repo, data);
        }
        break;

      case 'pull_request_review':
      case 'pull_request_review_comment':
      case 'pull_request_review_thread':
        if (owner && repo) {
          await invalidatePullRequestReviewRelatedCache(context, owner, repo, data);
        }
        break;

      case 'check_run':
      case 'check_suite':
        if (owner && repo) {
          await invalidateCheckRelatedCache(context, owner, repo, data);
        }
        break;

      case 'installation_repositories':
        await invalidateInstallationRepositoriesCache(context, data);
        break;

      case 'repository':
        if (owner && repo) {
          await invalidateEntireRepoCache(context, owner, repo);
        }
        break;
    }
  } catch (error) {
    console.error('[resource-invalidation] Failed to invalidate cache:', error);
  }
}

// ============================================================================
// Per-event invalidation helpers
// ============================================================================

async function invalidateIssueCache(
  context: GithubServiceContext,
  owner: string,
  repo: string,
  data: WebhookPayload,
): Promise<void> {
  const issue = data.issue as { number: number } | undefined;
  if (!issue?.number) return;

  await Promise.all([
    context.cache.deleteCache(CACHE_KEYS.GITHUB_ISSUE_DETAIL(owner, repo, issue.number)),
    context.cache.deleteCacheByPattern(
      CACHE_KEYS.GITHUB_RESPONSE_ISSUE_PATTERN(owner, repo, issue.number),
    ),
    invalidateExistingListCaches(context, owner, repo),
  ]);
}

async function invalidateIssueCommentCache(
  context: GithubServiceContext,
  owner: string,
  repo: string,
  data: WebhookPayload,
): Promise<void> {
  // created/edited expose a typed issue; narrow with guards. Other actions
  // (deleted) have no listed guard, so fall back to structural access.
  let issueNumber: number | undefined;
  let issuePullRequest: unknown;
  if (isIssueCommentCreatedEvent(data) || isIssueCommentEditedEvent(data)) {
    issueNumber = data.issue.number;
    issuePullRequest = data.issue.pull_request;
  } else {
    const issue = data.issue as { number: number; pull_request?: unknown } | undefined;
    issueNumber = issue?.number;
    issuePullRequest = issue?.pull_request;
  }
  if (!issueNumber) return;

  const invalidations: Promise<unknown>[] = [
    // Invalidate issue detail (commentsCount/updatedAt change)
    context.cache.deleteCache(CACHE_KEYS.GITHUB_ISSUE_DETAIL(owner, repo, issueNumber)),
    // Invalidate all comment caches for this issue
    context.cache.deleteCacheByPattern(
      CACHE_KEYS.GITHUB_RESPONSE_ISSUE_PATTERN(owner, repo, issueNumber),
    ),
  ];

  // If the issue is actually a PR, also invalidate PR detail (comment count changes)
  if (issuePullRequest) {
    invalidations.push(
      context.cache.deleteCache(CACHE_KEYS.GITHUB_PR_DETAIL(owner, repo, issueNumber)),
    );
  }

  await Promise.all(invalidations);
}

async function invalidatePullRequestCache(
  context: GithubServiceContext,
  owner: string,
  repo: string,
  data: WebhookPayload,
): Promise<void> {
  const pullRequest = data.pull_request as { number: number } | undefined;
  if (!pullRequest?.number) return;

  // Look up the repository once and share across both helpers that need it
  const repository = await getRepositoryByOwnerAndName(context, owner, repo).catch((error) => {
    console.error(`[resource-invalidation] Failed to look up repository ${owner}/${repo}:`, error);
    return null;
  });

  await Promise.all([
    context.cache.deleteCache(CACHE_KEYS.GITHUB_PR_DETAIL(owner, repo, pullRequest.number)),
    context.cache.deleteCacheByPattern(
      CACHE_KEYS.GITHUB_RESPONSE_PR_PATTERN(owner, repo, pullRequest.number),
    ),
    invalidateExistingListCachesForRepository(context, repository),
  ]);
}

async function invalidatePullRequestReviewRelatedCache(
  context: GithubServiceContext,
  owner: string,
  repo: string,
  data: WebhookPayload,
): Promise<void> {
  // Thread resolved/unresolved events expose typed pull_request + thread fields;
  // narrow with guards. Review and review_comment events have no thread guard
  // match, so fall back to structural access for those.
  const isThreadEvent =
    isPullRequestReviewThreadResolvedEvent(data) || isPullRequestReviewThreadUnresolvedEvent(data);

  let prNumber: number | undefined;
  let threadNodeId: string | undefined;
  if (isThreadEvent) {
    prNumber = data.pull_request.number;
    threadNodeId = data.thread.node_id;
  } else {
    const pullRequest = data.pull_request as { number: number } | undefined;
    prNumber = pullRequest?.number;
    const thread = data.thread as { node_id?: string } | undefined;
    threadNodeId = thread?.node_id;
  }
  if (!prNumber) return;

  const invalidations: Promise<unknown>[] = [
    context.cache.deleteCache(CACHE_KEYS.GITHUB_PR_DETAIL(owner, repo, prNumber)),
    // GITHUB_RESPONSE_PR_PATTERN covers: review-comments, thread-lookup, review-state, and check counts
    // for this PR. Thread-validate entries use a different key shape (keyed by threadId, not PR number)
    // and are invalidated individually below when thread.node_id is present.
    context.cache.deleteCacheByPattern(
      CACHE_KEYS.GITHUB_RESPONSE_PR_PATTERN(owner, repo, prNumber),
    ),
    // Invalidate cached review state — approval/changes-requested status may have changed
    context.cache.deleteCache(CACHE_KEYS.GITHUB_REVIEW_STATE(owner, repo, prNumber)),
  ];

  if (threadNodeId) {
    invalidations.push(
      context.cache.deleteCache(
        CACHE_KEYS.GITHUB_REVIEW_THREAD_VALIDATE(threadNodeId, owner, repo),
      ),
    );
  }

  await Promise.all(invalidations);
}

/**
 * Invalidate failing-check count caches when check runs/suites complete.
 *
 * Note: check_run and check_suite events include a head_sha that keys the
 * cached failing-check counts.
 */
async function invalidateCheckRelatedCache(
  context: GithubServiceContext,
  owner: string,
  repo: string,
  data: WebhookPayload,
): Promise<void> {
  // completed events expose a typed head_sha; narrow with guards. Other check
  // actions have no listed guard, so fall back to structural access.
  // check_run events have head_sha at data.check_run.head_sha
  // check_suite events have head_sha at data.check_suite.head_sha
  let headSha: string | undefined;
  if (isCheckRunCompletedEvent(data)) {
    headSha = data.check_run.head_sha;
  } else if (isCheckSuiteCompletedEvent(data)) {
    headSha = data.check_suite.head_sha;
  } else {
    const checkRun = data.check_run as { head_sha?: string } | undefined;
    const checkSuite = data.check_suite as { head_sha?: string } | undefined;
    headSha = checkRun?.head_sha ?? checkSuite?.head_sha;
  }

  // Invalidate cached failing check counts for this commit SHA
  if (headSha) {
    await context.cache.deleteCache(CACHE_KEYS.GITHUB_CHECK_COUNTS(owner, repo, headSha));
  }
}

async function invalidateInstallationRepositoriesCache(
  context: GithubServiceContext,
  data: WebhookPayload,
): Promise<void> {
  const installation = data.installation as { id: number } | undefined;
  if (!installation?.id) return;

  await context.cache.deleteCacheByPattern(
    CACHE_KEYS.GITHUB_RESPONSE_INSTALLATION_PATTERN(installation.id),
  );
}

async function invalidateEntireRepoCache(
  context: GithubServiceContext,
  owner: string,
  repo: string,
): Promise<void> {
  await context.cache.deleteCacheByPattern(CACHE_KEYS.GITHUB_RESPONSE_REPO_PATTERN(owner, repo));
}

// ============================================================================
// Existing list cache invalidation (via DB lookup for repositoryId)
// ============================================================================

/**
 * Invalidate existing list caches (issues list, PRs list) that use internal repositoryId.
 * Looks up the repositoryId from the database by owner/repo.
 * Skips if the repository is not tracked in the database.
 */
async function invalidateExistingListCaches(
  context: GithubServiceContext,
  owner: string,
  repo: string,
): Promise<void> {
  try {
    const repository = await getRepositoryByOwnerAndName(context, owner, repo);
    await invalidateExistingListCachesForRepository(context, repository);
  } catch (error) {
    console.error(
      `[resource-invalidation] Failed to invalidate list caches for ${owner}/${repo}:`,
      error,
    );
  }
}

/**
 * Invalidate list caches for a pre-fetched repository record.
 */
async function invalidateExistingListCachesForRepository(
  context: GithubServiceContext,
  repository: { id: number } | null,
): Promise<void> {
  if (!repository) return;

  try {
    await Promise.all([
      context.cache.deleteCacheByPattern(CACHE_KEYS.GITHUB_ISSUES_LIST_PATTERN(repository.id)),
      context.cache.deleteCacheByPattern(CACHE_KEYS.GITHUB_PRS_LIST_PATTERN(repository.id)),
    ]);
  } catch (error) {
    console.error(
      `[resource-invalidation] Failed to invalidate list caches for repository ${repository.id}:`,
      error,
    );
  }
}
