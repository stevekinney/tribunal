import { and, eq } from 'drizzle-orm';
import { pullRequestState } from '@tribunal/database/schema';
import { getInstallationForRepository } from '@tribunal/github/repositories/service';
import { getPullRequest, listPullRequests } from '@tribunal/github/pull-requests/service';
import type { PullRequestFilterState } from '@tribunal/github/types/pull-requests';
import { db } from '$lib/server/database';
import { githubContext } from '$lib/server/github-context';
import { findAccessibleRepository, type RepositoryReadError } from './repository-reader';

/** A pull request as a list result: identity and state, never body text. */
export type McpPullRequestSummary = {
  number: number;
  title: string;
  state: 'open' | 'closed';
  isDraft: boolean;
  authorLogin: string | null;
  headRef: string;
  baseRef: string;
  htmlUrl: string;
  updatedAt: string;
  mergedAt: string | null;
};

/**
 * Tribunal's stored view of a pull request's operational state.
 *
 * Restricted to the pull request, CI, review, and merge columns on purpose.
 * The same row also carries `automationStatus`, `attemptCount`,
 * `lastErrorMessage`, `lastTriggerSignature`, `signatureAttemptCount`,
 * `lastAttemptAt`, and `isPaused` — Tribunal's own workflow and operator
 * decisions, not GitHub pull request content, and so not what this scope's
 * consent text describes. A whole-row projection would disclose internal error
 * strings and pause state under a grant that never mentioned them. Exposing
 * them needs its own scope with its own disclosed copy.
 *
 * This is a stored projection rather than a live read, so it can be absent (no
 * review has touched the pull request) or lag GitHub. Both are visible to the
 * caller: absent is `null`, and each family carries its own updated-at.
 */
export type McpPullRequestOperationalState = {
  state: string;
  isDraft: boolean;
  isMerged: boolean;
  headSha: string | null;
  baseSha: string | null;
  baseRef: string | null;
  ciStatus: string;
  failingCheckCount: number;
  ciUpdatedAt: string | null;
  reviewStatus: string;
  approvalCount: number;
  changesRequestedCount: number;
  unresolvedThreadCount: number;
  reviewUpdatedAt: string | null;
  mergeStatus: string;
  mergeUpdatedAt: string | null;
  pullRequestUpdatedAt: string | null;
};

export type McpPullRequestDetail = McpPullRequestSummary & {
  /** The pull request body, authored by whoever opened it. */
  description: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  isMerged: boolean;
  /**
   * Counts, not content. `getPullRequest` returns how many comments and review
   * comments exist and not what they say, and this scope's consent copy is
   * narrowed to match rather than promising text no reader retrieves.
   */
  commentCount: number;
  reviewCommentCount: number;
  commitCount: number;
  operationalState: McpPullRequestOperationalState | null;
};

export type PullRequestReadError =
  | RepositoryReadError
  /** Not connected, or connected by somebody else — the caller cannot tell which. */
  | 'repository_not_found'
  /** The repository is the caller's, but its GitHub App installation did not resolve. */
  | 'github_unreachable'
  | 'pull_request_not_found';

export type PullRequestListResult =
  | {
      ok: true;
      pullRequests: McpPullRequestSummary[];
      page: number;
      perPage: number;
      hasNextPage: boolean;
    }
  | { ok: false; error: PullRequestReadError };

export type PullRequestDetailResult =
  { ok: true; pullRequest: McpPullRequestDetail } | { ok: false; error: PullRequestReadError };

/**
 * The columns of `pull_request_state` this scope may read, named one by one.
 *
 * A bare `.select()` would return the whole row and leave the exclusion to
 * whoever assembles the response — which reads as a projection but is not one:
 * the automation columns still cross the database boundary into the process,
 * where a log line, a query trace, or a later object spread can surface them.
 * Naming the columns keeps the withheld data in PostgreSQL, and
 * `pull-request-reader.test.ts` asserts against this object so the guarantee is
 * checked where it is made rather than at the far end of the response.
 */
export const pullRequestStateProjection = {
  state: pullRequestState.state,
  isDraft: pullRequestState.isDraft,
  isMerged: pullRequestState.isMerged,
  headSha: pullRequestState.headSha,
  baseSha: pullRequestState.baseSha,
  baseRef: pullRequestState.baseRef,
  ciStatus: pullRequestState.ciStatus,
  failingCheckCount: pullRequestState.failingCheckCount,
  ciUpdatedAt: pullRequestState.ciUpdatedAt,
  reviewStatus: pullRequestState.reviewStatus,
  approvalCount: pullRequestState.approvalCount,
  changesRequestedCount: pullRequestState.changesRequestedCount,
  unresolvedThreadCount: pullRequestState.unresolvedThreadCount,
  reviewUpdatedAt: pullRequestState.reviewUpdatedAt,
  mergeStatus: pullRequestState.mergeStatus,
  mergeUpdatedAt: pullRequestState.mergeUpdatedAt,
  prUpdatedAt: pullRequestState.prUpdatedAt,
} as const;

/**
 * Authorizes the repository *before* resolving its installation.
 *
 * `getInstallationForRepository` takes a repository identifier and no user
 * identifier, so resolving it first and checking access afterwards would hand
 * any scope-bearing caller an installation client for a repository somebody
 * else connected — and with it, that repository's private pull request
 * content. Tribunal's own route is safe for exactly this reason: it authorizes
 * first. Every pull request primitive here does the same.
 */
async function resolveAuthorizedInstallation(userId: number, repositoryId: number) {
  const accessible = await findAccessibleRepository(userId, repositoryId);
  if (!accessible.ok) return { ok: false, error: accessible.error } as const;
  if (!accessible.repository) return { ok: false, error: 'repository_not_found' } as const;

  const installation = await getInstallationForRepository(githubContext, repositoryId);
  if (!installation.ok) return { ok: false, error: 'github_unreachable' } as const;

  return {
    ok: true,
    octokit: installation.octokit,
    owner: installation.owner,
    repo: installation.repo,
  } as const;
}

function summarize(pullRequest: {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  author: { login: string } | null;
  headRef: string;
  baseRef: string;
  htmlUrl: string;
  updatedAt: string;
  mergedAt: string | null;
}): McpPullRequestSummary {
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    state: pullRequest.state,
    isDraft: pullRequest.draft,
    authorLogin: pullRequest.author?.login ?? null,
    headRef: pullRequest.headRef,
    baseRef: pullRequest.baseRef,
    htmlUrl: pullRequest.htmlUrl,
    updatedAt: pullRequest.updatedAt,
    mergedAt: pullRequest.mergedAt,
  };
}

export async function listRepositoryPullRequests(
  userId: number,
  input: { repositoryId: number; state: PullRequestFilterState; page: number; perPage: number },
): Promise<PullRequestListResult> {
  const installation = await resolveAuthorizedInstallation(userId, input.repositoryId);
  if (!installation.ok) return { ok: false, error: installation.error };

  const result = await listPullRequests(
    githubContext,
    installation.octokit,
    installation.owner,
    installation.repo,
    {
      state: input.state,
      sort: 'updated',
      direction: 'desc',
      page: input.page,
      perPage: input.perPage,
    },
    input.repositoryId,
  );

  return {
    ok: true,
    pullRequests: result.pullRequests.map(summarize),
    page: input.page,
    perPage: input.perPage,
    hasNextPage: result.hasNextPage,
  };
}

export async function getRepositoryPullRequest(
  userId: number,
  input: { repositoryId: number; pullRequestNumber: number },
): Promise<PullRequestDetailResult> {
  const installation = await resolveAuthorizedInstallation(userId, input.repositoryId);
  if (!installation.ok) return { ok: false, error: installation.error };

  const detail = await getPullRequest(
    githubContext,
    installation.octokit,
    installation.owner,
    installation.repo,
    input.pullRequestNumber,
  );
  if (!detail) return { ok: false, error: 'pull_request_not_found' };

  const [storedState] = await db
    .select(pullRequestStateProjection)
    .from(pullRequestState)
    .where(
      and(
        eq(pullRequestState.repositoryId, input.repositoryId),
        eq(pullRequestState.prNumber, input.pullRequestNumber),
      ),
    );

  return {
    ok: true,
    pullRequest: {
      ...summarize(detail),
      description: detail.body,
      additions: detail.additions,
      deletions: detail.deletions,
      changedFiles: detail.changedFiles,
      isMerged: detail.merged,
      commentCount: detail.comments,
      reviewCommentCount: detail.reviewComments,
      commitCount: detail.commits,
      operationalState: storedState
        ? {
            state: storedState.state,
            isDraft: storedState.isDraft,
            isMerged: storedState.isMerged,
            headSha: storedState.headSha,
            baseSha: storedState.baseSha,
            baseRef: storedState.baseRef,
            ciStatus: storedState.ciStatus,
            failingCheckCount: storedState.failingCheckCount,
            ciUpdatedAt: storedState.ciUpdatedAt?.toISOString() ?? null,
            reviewStatus: storedState.reviewStatus,
            approvalCount: storedState.approvalCount,
            changesRequestedCount: storedState.changesRequestedCount,
            unresolvedThreadCount: storedState.unresolvedThreadCount,
            reviewUpdatedAt: storedState.reviewUpdatedAt?.toISOString() ?? null,
            mergeStatus: storedState.mergeStatus,
            mergeUpdatedAt: storedState.mergeUpdatedAt?.toISOString() ?? null,
            pullRequestUpdatedAt: storedState.prUpdatedAt?.toISOString() ?? null,
          }
        : null,
    },
  };
}
