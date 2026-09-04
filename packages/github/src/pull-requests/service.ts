/**
 * GitHub Pull Request operations for repository detail views.
 *
 * Provides access to pull requests via GitHub's REST API.
 * Used by server endpoints to display and manage PRs.
 */
import type { Endpoints } from '@octokit/types';
import type { Octokit as OctokitType } from 'octokit';
import { transformAuthor, encodeFilterValue, resolveHasNextPage } from '@tribunal/github/shared';
import { isNotFoundError, isNotModifiedError } from '@tribunal/github/errors';
import type { GithubServiceContext } from '../context.js';
import { cachedRead } from '../core/github-read-client.js';
import { requirePolicy, assertPartitionInstallationId } from '../core/cache-policy.js';
import { getFailingCheckCount } from './state/queries.js';

// Re-export error helpers for external consumers
export {
  isRateLimitError,
  isNotFoundError,
  isForbiddenError,
  isValidationError,
} from '@tribunal/github/errors';

// ============================================================================
// Types derived from Octokit
// ============================================================================

type GitHubPullRequestListItem =
  Endpoints['GET /repos/{owner}/{repo}/pulls']['response']['data'][number];

type GitHubPullRequestDetail =
  Endpoints['GET /repos/{owner}/{repo}/pulls/{pull_number}']['response']['data'];

// ============================================================================
// Public types — re-exported from @tribunal/github package
// ============================================================================

export type {
  PullRequestFilterState,
  PullRequestSort,
  PullRequestFilterOptions,
  PullRequestAuthor,
  PullRequestListItem,
  PullRequestDetail,
  PullRequestListResult,
  PullRequestOperationalStatus,
} from '@tribunal/github/types/pull-requests';

import type {
  PullRequestFilterState,
  PullRequestSort,
  PullRequestFilterOptions,
  PullRequestListItem,
  PullRequestDetail,
  PullRequestListResult,
  PullRequestOperationalStatus,
} from '@tribunal/github/types/pull-requests';

import type { SortDirection } from '@tribunal/github/shared';

// ============================================================================
// Filter parsing
// ============================================================================

const VALID_STATES: PullRequestFilterState[] = ['open', 'closed', 'all'];
const VALID_SORTS: PullRequestSort[] = ['created', 'updated', 'popularity', 'long-running'];
const VALID_DIRECTIONS: SortDirection[] = ['asc', 'desc'];

/**
 * Parse pull request filter options from URL search params.
 * Uses 'pr_' prefix to avoid conflicts with other filters on the same page.
 */
export function parsePullRequestFilters(url: URL): PullRequestFilterOptions {
  const state = (url.searchParams.get('pr_state') as PullRequestFilterState) ?? 'open';
  const sort = (url.searchParams.get('pr_sort') as PullRequestSort) ?? 'updated';
  const direction = (url.searchParams.get('pr_direction') as SortDirection) ?? 'desc';
  const head = url.searchParams.get('pr_head') ?? undefined;
  const base = url.searchParams.get('pr_base') ?? undefined;
  const page = Math.max(1, parseInt(url.searchParams.get('pr_page') ?? '1', 10) || 1);
  const perPage = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('pr_per_page') ?? '30', 10) || 30),
  );

  return {
    state: VALID_STATES.includes(state) ? state : 'open',
    sort: VALID_SORTS.includes(sort) ? sort : 'updated',
    direction: VALID_DIRECTIONS.includes(direction) ? direction : 'desc',
    head: head || undefined,
    base: base || undefined,
    page,
    perPage,
  };
}

/**
 * Get the selected PR number from URL search params.
 */
export function getSelectedPullRequestNumber(url: URL): number | null {
  const prNumber = url.searchParams.get('pr_number');
  if (!prNumber) return null;
  const parsed = parseInt(prNumber, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// ============================================================================
// Response transformation
// ============================================================================

function transformPullRequestListItem(pr: GitHubPullRequestListItem): PullRequestListItem {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state as 'open' | 'closed',
    draft: pr.draft ?? false,
    author: transformAuthor(pr.user),
    updatedAt: pr.updated_at,
    mergedAt: pr.merged_at,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    htmlUrl: pr.html_url,
  };
}

function transformPullRequestDetail(pr: GitHubPullRequestDetail): PullRequestDetail {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state as 'open' | 'closed',
    draft: pr.draft ?? false,
    author: transformAuthor(pr.user),
    updatedAt: pr.updated_at,
    mergedAt: pr.merged_at,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    htmlUrl: pr.html_url,
    body: pr.body,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    mergeable: pr.mergeable,
    mergeableState: pr.mergeable_state,
    merged: pr.merged,
    mergedBy: transformAuthor(pr.merged_by),
    comments: pr.comments,
    reviewComments: pr.review_comments,
    commits: pr.commits,
    headSha: pr.head.sha,
  };
}

type PullRequestReviewThreadsGraphqlResult = {
  repository: {
    pullRequest: {
      reviewThreads: {
        nodes: Array<{ isResolved: boolean } | null>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } | null;
  } | null;
};

type PullRequestReviewThreadCounts = Pick<
  PullRequestOperationalStatus,
  'resolvedReviewThreadCount' | 'unresolvedReviewThreadCount'
>;

function normalizeCiStatus(status: string): PullRequestOperationalStatus['ciStatus'] {
  if (status === 'passing' || status === 'failing' || status === 'pending') return status;
  if (status === 'error') return 'failing';
  return 'unknown';
}

function resolveMergeConflictStatus(
  pullRequest: PullRequestDetail | null,
): PullRequestOperationalStatus['mergeConflictStatus'] {
  if (!pullRequest) return 'unknown';
  if (pullRequest.mergeable === false || pullRequest.mergeableState === 'dirty') {
    return 'conflicting';
  }
  if (pullRequest.mergeable === true) return 'clean';
  return 'unknown';
}

// ============================================================================
// Caching
// ============================================================================

function buildPullRequestFilterKey(filters: PullRequestFilterOptions): string {
  const parts = [
    `s:${filters.state}`,
    `sort:${filters.sort}`,
    `dir:${filters.direction}`,
    `p:${filters.page}`,
    `pp:${filters.perPage}`,
  ];
  if (filters.head) parts.push(`h:${encodeFilterValue(filters.head)}`);
  if (filters.base) parts.push(`b:${encodeFilterValue(filters.base)}`);
  return parts.join('|');
}

// ============================================================================
// GitHub API operations
// ============================================================================

/**
 * List pull requests for a repository.
 *
 * Uses GitHub REST API: GET /repos/{owner}/{repo}/pulls
 * @see https://docs.github.com/en/rest/pulls/pulls#list-pull-requests
 *
 * @param context - Service context with cache operations
 * @param octokit - Authenticated Octokit client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param filters - Filter and pagination options
 * @param installationId - Installation whose credentials authenticated `octokit`.
 *   This partitions the cache entry; passing any other installation's id would
 *   let one installation read another's cached content.
 * @param repositoryId - Internal repository ID for Redis caching (optional)
 */
export async function listPullRequests(
  context: GithubServiceContext,
  octokit: OctokitType,
  owner: string,
  repo: string,
  filters: PullRequestFilterOptions,
  installationId: number,
  repositoryId?: number,
): Promise<PullRequestListResult> {
  // Before any cache access: an id that cannot partition a key must fail
  // rather than quietly share one.
  assertPartitionInstallationId(installationId);
  const fetchPullRequests = async (): Promise<PullRequestListResult> => {
    const response = await octokit.rest.pulls.list({
      owner,
      repo,
      state: filters.state,
      sort: filters.sort,
      direction: filters.direction,
      head: filters.head,
      base: filters.base,
      page: filters.page,
      per_page: filters.perPage,
    });

    return {
      pullRequests: response.data.map(transformPullRequestListItem),
      filters,
      hasNextPage: resolveHasNextPage(response.headers?.link),
    };
  };

  // When no repositoryId is provided, caching is not possible — call directly
  if (repositoryId === undefined) {
    return fetchPullRequests();
  }

  const policy = requirePolicy('list-pull-requests');
  const { value } = await cachedRead(
    context.cache,
    policy,
    async () => ({ data: await fetchPullRequests() }),
    [repositoryId, installationId, buildPullRequestFilterKey(filters)],
  );
  return value;
}

/**
 * Get a single pull request with full details.
 *
 * Uses GitHub REST API: GET /repos/{owner}/{repo}/pulls/{pull_number}
 * @see https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request
 *
 * @param context - Service context with cache operations
 * @param octokit - Authenticated Octokit client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param pullNumber - Pull request number
 * @param installationId - Installation whose credentials authenticated `octokit`.
 *   This partitions the cache entry; passing any other installation's id would
 *   let one installation read another's cached content.
 */
export async function getPullRequest(
  context: GithubServiceContext,
  octokit: OctokitType,
  owner: string,
  repo: string,
  pullNumber: number,
  installationId: number,
): Promise<PullRequestDetail | null> {
  // Outside the try: a partition failure is a programming error, never a 404.
  assertPartitionInstallationId(installationId);
  try {
    const policy = requirePolicy('get-pull-request');
    const { value } = await cachedRead<PullRequestDetail>(
      context.cache,
      policy,
      async (etag?: string) => {
        try {
          const response = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: pullNumber,
            headers: etag ? { 'if-none-match': etag } : undefined,
          });
          return {
            data: transformPullRequestDetail(response.data),
            etag: response.headers?.etag,
          };
        } catch (error) {
          if (etag && isNotModifiedError(error)) {
            return { notModified: true as const };
          }
          throw error;
        }
      },
      [owner, repo, pullNumber, installationId],
    );
    return value;
  } catch (error) {
    // Return null for 404 (PR not found)
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function getPullRequestOperationalStatus(
  context: GithubServiceContext,
  octokit: OctokitType,
  owner: string,
  repo: string,
  pullNumber: number,
  headSha: string,
  installationId: number,
): Promise<PullRequestOperationalStatus> {
  const [detailResult, ciResult, threadCountsResult] = await Promise.allSettled([
    getPullRequest(context, octokit, owner, repo, pullNumber, installationId),
    getFailingCheckCount(context, octokit, owner, repo, headSha, installationId),
    getPullRequestReviewThreadCounts(context, octokit, owner, repo, pullNumber, installationId),
  ]);

  const pullRequest = detailResult.status === 'fulfilled' ? detailResult.value : null;
  const ciState = ciResult.status === 'fulfilled' ? ciResult.value : null;
  const threadCounts = threadCountsResult.status === 'fulfilled' ? threadCountsResult.value : null;

  return {
    ciStatus: ciState ? normalizeCiStatus(ciState.ciStatus) : 'unknown',
    checkCount: ciState?.checkCount ?? 0,
    resolvedReviewThreadCount: threadCounts?.resolvedReviewThreadCount ?? null,
    unresolvedReviewThreadCount: threadCounts?.unresolvedReviewThreadCount ?? null,
    mergeConflictStatus: resolveMergeConflictStatus(pullRequest),
    mergeableState: pullRequest?.mergeableState ?? null,
  };
}

async function getPullRequestReviewThreadCounts(
  context: GithubServiceContext,
  octokit: OctokitType,
  owner: string,
  repo: string,
  pullNumber: number,
  installationId: number,
): Promise<PullRequestReviewThreadCounts> {
  // Before any cache access: an id that cannot partition a key must fail
  // rather than quietly share one.
  assertPartitionInstallationId(installationId);
  const fetchThreadCounts = async (): Promise<PullRequestReviewThreadCounts> => {
    let resolvedReviewThreadCount = 0;
    let unresolvedReviewThreadCount = 0;
    let after: string | null = null;

    do {
      const result: PullRequestReviewThreadsGraphqlResult =
        await octokit.graphql<PullRequestReviewThreadsGraphqlResult>(
          `
            query PullRequestReviewThreads(
              $owner: String!
              $repo: String!
              $pullNumber: Int!
              $after: String
            ) {
              repository(owner: $owner, name: $repo) {
                pullRequest(number: $pullNumber) {
                  reviewThreads(first: 100, after: $after) {
                    nodes {
                      isResolved
                    }
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                  }
                }
              }
            }
          `,
          { owner, repo, pullNumber, after },
        );

      const reviewThreads = result.repository?.pullRequest?.reviewThreads;
      if (!reviewThreads) break;

      for (const thread of reviewThreads.nodes) {
        if (!thread) continue;
        if (thread.isResolved) {
          resolvedReviewThreadCount += 1;
        } else {
          unresolvedReviewThreadCount += 1;
        }
      }

      after = reviewThreads.pageInfo.hasNextPage ? reviewThreads.pageInfo.endCursor : null;
    } while (after);

    return { resolvedReviewThreadCount, unresolvedReviewThreadCount };
  };

  const policy = requirePolicy('get-review-thread-counts');
  const { value } = await cachedRead<PullRequestReviewThreadCounts>(
    context.cache,
    policy,
    async () => ({ data: await fetchThreadCounts() }),
    [owner, repo, pullNumber, installationId],
  );
  return value;
}
