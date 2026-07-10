/**
 * GitHub repository issue operations for repository detail views.
 *
 * Provides access to true repository issues via GitHub's REST API. GitHub
 * models pull requests as issues internally, so `issues.listForRepo` can
 * return pull request rows identified by a `pull_request` key — this module
 * filters those out before returning `IssueListItem[]`.
 */
import type { Endpoints } from '@octokit/types';
import type { Octokit as OctokitType } from 'octokit';
import { transformAuthor, encodeFilterValue } from '@tribunal/github/shared';
import type { GithubServiceContext } from '../context.js';
import { cachedRead } from '../core/github-read-client.js';
import { requirePolicy } from '../core/cache-policy.js';

// ============================================================================
// Types derived from Octokit
// ============================================================================

type GitHubIssueListItem =
  Endpoints['GET /repos/{owner}/{repo}/issues']['response']['data'][number];

// ============================================================================
// Public types — re-exported from @tribunal/github package
// ============================================================================

export type {
  IssueFilterState,
  IssueSort,
  IssueFilterOptions,
  IssueAuthor,
  IssueLabel,
  IssueMilestone,
  IssueListItem,
  IssueListResult,
} from '@tribunal/github/types/issues';

import type {
  IssueFilterState,
  IssueSort,
  IssueFilterOptions,
  IssueLabel,
  IssueMilestone,
  IssueListItem,
  IssueListResult,
} from '@tribunal/github/types/issues';

import type { SortDirection } from '@tribunal/github/shared';

// ============================================================================
// Filter parsing
// ============================================================================

const VALID_STATES: IssueFilterState[] = ['open', 'closed', 'all'];
const VALID_SORTS: IssueSort[] = ['created', 'updated', 'comments'];
const VALID_DIRECTIONS: SortDirection[] = ['asc', 'desc'];

/**
 * GitHub's `milestone` filter on `GET /repos/{owner}/{repo}/issues` only
 * accepts a milestone number, the literal `*` (any milestone), or the literal
 * `none` (no milestone). Anything else — e.g. a bookmarked URL carrying a
 * milestone title like `v1.0` — is rejected by GitHub with a validation
 * error, so invalid values are dropped here instead of being forwarded.
 * @see https://docs.github.com/en/rest/issues/issues#list-repository-issues
 */
const VALID_MILESTONE_PATTERN = /^(\d+|\*|none)$/;

function parseMilestoneFilter(rawMilestone: string | undefined): string | undefined {
  if (!rawMilestone) return undefined;
  return VALID_MILESTONE_PATTERN.test(rawMilestone) ? rawMilestone : undefined;
}

/**
 * Parse issue filter options from URL search params.
 * Uses an `issue_` prefix to avoid conflicts with other filters on the same page.
 */
export function parseIssueFilters(url: URL): IssueFilterOptions {
  const state = (url.searchParams.get('issue_state') as IssueFilterState) ?? 'open';
  const sort = (url.searchParams.get('issue_sort') as IssueSort) ?? 'updated';
  const direction = (url.searchParams.get('issue_direction') as SortDirection) ?? 'desc';
  const assignee = url.searchParams.get('issue_assignee') ?? undefined;
  const creator = url.searchParams.get('issue_creator') ?? undefined;
  const mentioned = url.searchParams.get('issue_mentioned') ?? undefined;
  const labels = url.searchParams.get('issue_labels') ?? undefined;
  const milestone = url.searchParams.get('issue_milestone') ?? undefined;
  const type = url.searchParams.get('issue_type') ?? undefined;
  const page = Math.max(1, parseInt(url.searchParams.get('issue_page') ?? '1', 10) || 1);
  const perPage = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('issue_per_page') ?? '30', 10) || 30),
  );

  return {
    state: VALID_STATES.includes(state) ? state : 'open',
    sort: VALID_SORTS.includes(sort) ? sort : 'updated',
    direction: VALID_DIRECTIONS.includes(direction) ? direction : 'desc',
    assignee: assignee || undefined,
    creator: creator || undefined,
    mentioned: mentioned || undefined,
    labels: labels || undefined,
    milestone: parseMilestoneFilter(milestone),
    type: type || undefined,
    page,
    perPage,
  };
}

// ============================================================================
// Response transformation
// ============================================================================

// Label type that covers both string and object shapes GitHub returns.
type GitHubLabel =
  | string
  | {
      name?: string;
      color?: string | null;
      description?: string | null;
    };

function transformLabel(label: GitHubLabel): IssueLabel {
  if (typeof label === 'string') {
    return { name: label, color: '', description: null };
  }
  return {
    name: label.name ?? '',
    color: label.color ?? '',
    description: label.description ?? null,
  };
}

function transformMilestone(milestone: GitHubIssueListItem['milestone']): IssueMilestone | null {
  if (!milestone) return null;
  return {
    number: milestone.number,
    title: milestone.title,
    state: milestone.state,
    htmlUrl: milestone.html_url,
  };
}

/** True when a GitHub issue-shaped row is actually a pull request. */
function isPullRequestRow(issue: GitHubIssueListItem): boolean {
  return 'pull_request' in issue && issue.pull_request !== undefined;
}

/**
 * Determine whether another page of results exists.
 *
 * Relies solely on GitHub's `Link` response header (`rel="next"`), which is
 * the only exact signal: GitHub omits the header entirely once a page is the
 * only (or last) page, even when that page happens to contain exactly
 * `perPage` rows. A row-count heuristic would misread that case as "more
 * pages exist" and enable a Next control that navigates to an empty page.
 */
function resolveHasNextPage(linkHeader: string | undefined): boolean {
  if (!linkHeader) return false;
  return /<[^>]+>;\s*rel="next"/.test(linkHeader);
}

function transformIssueListItem(issue: GitHubIssueListItem): IssueListItem {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state as 'open' | 'closed',
    author: transformAuthor(issue.user),
    labels: issue.labels.map(transformLabel),
    assignees: (issue.assignees ?? []).flatMap((assignee) => {
      const author = transformAuthor(assignee);
      return author ? [author] : [];
    }),
    commentCount: issue.comments,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at,
    milestone: transformMilestone(issue.milestone),
    issueType: issue.type?.name ?? null,
    htmlUrl: issue.html_url,
  };
}

// ============================================================================
// Caching
// ============================================================================

function buildIssueFilterKey(filters: IssueFilterOptions): string {
  const parts = [
    `s:${filters.state}`,
    `sort:${filters.sort}`,
    `dir:${filters.direction}`,
    `p:${filters.page}`,
    `pp:${filters.perPage}`,
  ];
  if (filters.assignee) parts.push(`a:${encodeFilterValue(filters.assignee)}`);
  if (filters.creator) parts.push(`c:${encodeFilterValue(filters.creator)}`);
  if (filters.mentioned) parts.push(`m:${encodeFilterValue(filters.mentioned)}`);
  if (filters.labels) parts.push(`l:${encodeFilterValue(filters.labels)}`);
  if (filters.milestone) parts.push(`ms:${encodeFilterValue(filters.milestone)}`);
  if (filters.type) parts.push(`t:${encodeFilterValue(filters.type)}`);
  return parts.join('|');
}

// ============================================================================
// GitHub API operations
// ============================================================================

/**
 * List true repository issues (pull requests filtered out).
 *
 * Uses GitHub REST API: GET /repos/{owner}/{repo}/issues
 * @see https://docs.github.com/en/rest/issues/issues#list-repository-issues
 *
 * @param context - Service context with cache operations
 * @param octokit - Authenticated Octokit client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param filters - Filter and pagination options
 * @param repositoryId - Internal repository ID for Redis caching (optional)
 */
export async function listIssues(
  context: GithubServiceContext,
  octokit: OctokitType,
  owner: string,
  repo: string,
  filters: IssueFilterOptions,
  repositoryId?: number,
): Promise<IssueListResult> {
  const fetchIssues = async (): Promise<IssueListResult> => {
    const response = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: filters.state,
      sort: filters.sort,
      direction: filters.direction,
      assignee: filters.assignee,
      creator: filters.creator,
      mentioned: filters.mentioned,
      labels: filters.labels,
      milestone: filters.milestone,
      type: filters.type,
      page: filters.page,
      per_page: filters.perPage,
    });

    const issues = response.data
      .filter((issue) => !isPullRequestRow(issue))
      .map(transformIssueListItem);

    return {
      issues,
      hasNextPage: resolveHasNextPage(response.headers.link),
      filters,
    };
  };

  // When no repositoryId is provided, caching is not possible — call directly
  if (repositoryId === undefined) {
    return fetchIssues();
  }

  const policy = requirePolicy('list-issues');
  const { value } = await cachedRead(
    context.cache,
    policy,
    async () => ({ data: await fetchIssues() }),
    [repositoryId, buildIssueFilterKey(filters)],
  );
  return value;
}
