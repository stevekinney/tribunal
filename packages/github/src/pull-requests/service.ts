/**
 * GitHub Pull Request operations for repository detail views.
 *
 * Provides access to pull requests via GitHub's REST API.
 * Used by server endpoints to display and manage PRs.
 */
import type { Endpoints } from '@octokit/types';
import type { Octokit as OctokitType } from 'octokit';
import { transformAuthor, encodeFilterValue } from '@tribunal/github/shared';
import {
  isNotFoundError,
  isNotModifiedError,
  isValidationError,
  isForbiddenError,
  isRateLimitError,
  isUnauthorizedError,
  getErrorMessage,
  parseValidationErrorReason,
  type ValidationErrorReason,
} from '@tribunal/github/errors';
import type { GithubServiceContext } from '../context.js';
import { cachedRead } from '../core/github-read-client.js';
import { requirePolicy } from '../core/cache-policy.js';

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
  PullRequestLabel,
  PullRequestListItem,
  PullRequestDetail,
  PullRequestListResult,
  PullRequestOperationalStatus,
} from '@tribunal/github/types/pull-requests';

import type {
  PullRequestFilterState,
  PullRequestSort,
  PullRequestFilterOptions,
  PullRequestLabel,
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

// Label type that covers both list and detail endpoints
type GitHubLabel =
  | string
  | {
      name?: string;
      color?: string;
      description?: string | null;
    };

function transformLabel(label: GitHubLabel): PullRequestLabel {
  // Labels can be strings or objects depending on GitHub API response
  if (typeof label === 'string') {
    return { name: label, color: '', description: null };
  }
  return {
    name: label.name ?? '',
    color: label.color ?? '',
    description: label.description ?? null,
  };
}

function transformPullRequestListItem(pr: GitHubPullRequestListItem): PullRequestListItem {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state as 'open' | 'closed',
    draft: pr.draft ?? false,
    locked: pr.locked,
    author: transformAuthor(pr.user),
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    closedAt: pr.closed_at,
    mergedAt: pr.merged_at,
    labels: pr.labels.map(transformLabel),
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    htmlUrl: pr.html_url,
  };
}

function transformPullRequestDetail(pr: GitHubPullRequestDetail): PullRequestDetail {
  // Transform detail PR separately to handle different label types
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state as 'open' | 'closed',
    draft: pr.draft ?? false,
    locked: pr.locked,
    author: transformAuthor(pr.user),
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    closedAt: pr.closed_at,
    mergedAt: pr.merged_at,
    labels: pr.labels.map(transformLabel),
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
  };
}

type PullRequestReviewThreadsGraphqlResult = {
  repository: {
    pullRequest: {
      reviewThreads: {
        nodes: Array<{ isResolved: boolean } | null>;
      };
    } | null;
  } | null;
};

function resolveCiStatus(
  checkRuns: Endpoints['GET /repos/{owner}/{repo}/commits/{ref}/check-runs']['response']['data']['check_runs'],
): PullRequestOperationalStatus['ciStatus'] {
  if (checkRuns.length === 0) return 'unknown';
  if (checkRuns.some((run) => run.status !== 'completed')) return 'pending';
  if (
    checkRuns.some(
      (run) =>
        run.conclusion !== 'success' &&
        run.conclusion !== 'neutral' &&
        run.conclusion !== 'skipped',
    )
  ) {
    return 'failing';
  }
  return 'passing';
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
 * @param repositoryId - Internal repository ID for Redis caching (optional)
 */
export async function listPullRequests(
  context: GithubServiceContext,
  octokit: OctokitType,
  owner: string,
  repo: string,
  filters: PullRequestFilterOptions,
  repositoryId?: number,
): Promise<PullRequestListResult> {
  // When no repositoryId is provided, caching is not possible — call directly
  if (repositoryId === undefined) {
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
    return { pullRequests: response.data.map(transformPullRequestListItem), filters };
  }

  const policy = requirePolicy('list-pull-requests');
  const { value } = await cachedRead(
    context.cache,
    policy,
    async () => {
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
        data: { pullRequests: response.data.map(transformPullRequestListItem), filters },
      };
    },
    [repositoryId, buildPullRequestFilterKey(filters)],
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
 */
export async function getPullRequest(
  context: GithubServiceContext,
  octokit: OctokitType,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestDetail | null> {
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
      [owner, repo, pullNumber],
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
  octokit: OctokitType,
  owner: string,
  repo: string,
  pullNumber: number,
  headRef: string,
): Promise<PullRequestOperationalStatus> {
  const [detailResult, checksResult, threadsResult] = await Promise.allSettled([
    octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber }),
    octokit.rest.checks.listForRef({ owner, repo, ref: headRef }),
    octokit.graphql<PullRequestReviewThreadsGraphqlResult>(
      `
        query PullRequestReviewThreads($owner: String!, $repo: String!, $pullNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $pullNumber) {
              reviewThreads(first: 100) {
                nodes {
                  isResolved
                }
              }
            }
          }
        }
      `,
      { owner, repo, pullNumber },
    ),
  ]);

  const pullRequest =
    detailResult.status === 'fulfilled'
      ? transformPullRequestDetail(detailResult.value.data)
      : null;
  const checkRuns = checksResult.status === 'fulfilled' ? checksResult.value.data.check_runs : [];
  const reviewThreads =
    threadsResult.status === 'fulfilled'
      ? (threadsResult.value.repository?.pullRequest?.reviewThreads.nodes ?? [])
      : [];
  const resolvedReviewThreadCount = reviewThreads.filter((thread) => thread?.isResolved).length;
  const unresolvedReviewThreadCount = reviewThreads.filter(
    (thread) => thread && !thread.isResolved,
  ).length;

  return {
    ciStatus: checksResult.status === 'fulfilled' ? resolveCiStatus(checkRuns) : 'unknown',
    checkCount: checkRuns.length,
    resolvedReviewThreadCount,
    unresolvedReviewThreadCount,
    mergeConflictStatus: resolveMergeConflictStatus(pullRequest),
    mergeableState: pullRequest?.mergeableState ?? null,
  };
}

// ============================================================================
// Request Reviewers Types
// ============================================================================

/** Input for requesting reviewers on a pull request. */
export interface RequestReviewersInput {
  /** GitHub usernames to request as reviewers. */
  reviewers?: string[];
  /** Team slugs to request as reviewers (organization repos only). */
  teamReviewers?: string[];
}

/** A reviewer that was successfully requested. */
export interface RequestedReviewer {
  login: string;
  avatarUrl: string | null;
  htmlUrl: string;
}

/** A team that was successfully requested. */
export interface RequestedTeam {
  id: number;
  slug: string;
  name: string;
  description: string | null;
}

/** Result of a successful request reviewers operation. */
export interface RequestReviewersResult {
  success: true;
  /** Users that were successfully requested. */
  requestedReviewers: RequestedReviewer[];
  /** Teams that were successfully requested. */
  requestedTeams: RequestedTeam[];
}

/** Error result for request reviewers operation. */
export interface RequestReviewersError {
  success: false;
  error: RequestReviewersErrorCode;
  reason?: ValidationErrorReason;
  message: string;
}

export type RequestReviewersErrorCode =
  | 'not_found' // PR not found
  | 'forbidden' // No permission
  | 'unauthorized' // Invalid token
  | 'validation_failed' // Invalid input (422) - user/team not found, self-review, etc.
  | 'rate_limited'
  | 'unknown';

export type RequestReviewersResponse = RequestReviewersResult | RequestReviewersError;

// ============================================================================
// Request Reviewers Operation
// ============================================================================

// Response type from Octokit
type GitHubRequestReviewersResponse =
  Endpoints['POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers']['response']['data'];

/**
 * Request reviewers for a pull request.
 *
 * Uses GitHub REST API: POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers
 * @see https://docs.github.com/en/rest/pulls/review-requests#request-reviewers-for-a-pull-request
 *
 * This operation is idempotent - requesting an already-requested reviewer succeeds.
 *
 * @param octokit - Authenticated Octokit client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param pullNumber - Pull request number
 * @param input - Reviewers to request
 * @returns Requested reviewers or error
 */
export async function requestReviewers(
  octokit: OctokitType,
  owner: string,
  repo: string,
  pullNumber: number,
  input: RequestReviewersInput,
): Promise<RequestReviewersResponse> {
  // Validate input
  const hasReviewers = input.reviewers && input.reviewers.length > 0;
  const hasTeams = input.teamReviewers && input.teamReviewers.length > 0;

  if (!hasReviewers && !hasTeams) {
    return {
      success: false,
      error: 'validation_failed',
      message: 'At least one reviewer or team must be specified',
    };
  }

  try {
    const response = await octokit.rest.pulls.requestReviewers({
      owner,
      repo,
      pull_number: pullNumber,
      reviewers: input.reviewers,
      team_reviewers: input.teamReviewers,
    });

    return {
      success: true,
      requestedReviewers: transformRequestedReviewers(response.data),
      requestedTeams: transformRequestedTeams(response.data),
    };
  } catch (error) {
    return handleRequestReviewersError(error);
  }
}

// ============================================================================
// Transformation helpers
// ============================================================================

function transformRequestedReviewers(data: GitHubRequestReviewersResponse): RequestedReviewer[] {
  const reviewers = data.requested_reviewers ?? [];
  return reviewers.map((r) => ({
    login: r.login,
    avatarUrl: r.avatar_url ?? null,
    htmlUrl: r.html_url,
  }));
}

function transformRequestedTeams(data: GitHubRequestReviewersResponse): RequestedTeam[] {
  const teams = data.requested_teams ?? [];
  return teams.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description ?? null,
  }));
}

// ============================================================================
// Error handling for request reviewers
// ============================================================================

function handleRequestReviewersError(error: unknown): RequestReviewersError {
  if (isNotFoundError(error)) {
    return {
      success: false,
      error: 'not_found',
      message: 'Pull request not found',
    };
  }

  if (isUnauthorizedError(error)) {
    return {
      success: false,
      error: 'unauthorized',
      message: 'Your GitHub session has expired. Please sign in again.',
    };
  }

  if (isRateLimitError(error)) {
    return {
      success: false,
      error: 'rate_limited',
      message: 'GitHub API rate limit exceeded. Please try again later.',
    };
  }

  if (isForbiddenError(error)) {
    return {
      success: false,
      error: 'forbidden',
      message: "You don't have permission to request reviewers on this pull request",
    };
  }

  if (isValidationError(error)) {
    const reason = parseValidationErrorReason(error);
    const message = getReviewerValidationMessage(reason, error);
    return {
      success: false,
      error: 'validation_failed',
      reason,
      message,
    };
  }

  return {
    success: false,
    error: 'unknown',
    message: getErrorMessage(error),
  };
}

function getReviewerValidationMessage(reason: ValidationErrorReason, error: unknown): string {
  switch (reason) {
    case 'self_review':
      return 'Pull request authors cannot be requested as reviewers';
    case 'user_not_found':
      return 'One or more requested reviewers were not found';
    case 'team_not_found':
      return 'One or more requested teams were not found';
    case 'no_access':
      return 'One or more requested reviewers do not have access to this repository';
    case 'pr_closed':
      return 'Cannot request reviewers on a closed or merged pull request';
    default:
      return getErrorMessage(error);
  }
}
