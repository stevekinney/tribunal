import { and, eq } from 'drizzle-orm';
import { pullRequestState } from '@tribunal/database/schema';
import {
  getPullRequest,
  isRateLimitError,
  listPullRequests,
} from '@tribunal/github/pull-requests/service';
import type { PullRequestFilterState } from '@tribunal/github/types/pull-requests';
import { db } from '$lib/server/database';
import { githubContext } from '$lib/server/github-context';
import {
  findAccessibleRepository,
  findAccessibleRepositoriesByName,
  type McpRepository,
  type RepositoryReadError,
} from './repository-reader';

/** A pull request as a list result: identity and state, never body text. */
export type McpPullRequestSummary = {
  number: number;
  title: string;
  state: 'open' | 'closed';
  isDraft: boolean;
  authorLogin: string | null;
  headRef: string;
  /** The commit GitHub reports as head right now. */
  headSha: string;
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
  /**
   * Whether this stored state describes the commit that is head right now.
   *
   * False means a push landed after the last review touched the pull request,
   * or that the state update failed — so the CI, review, and merge values
   * describe an earlier commit. Reported rather than suppressed: "passing, for
   * the previous commit" is useful, and "passing" presented as current when it
   * is not is the failure worth preventing.
   */
  describesCurrentHead: boolean;
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

/**
 * Which repository a pull request call is about.
 *
 * Either form is accepted because the two scopes are granted independently: a
 * client holding `pull_requests:read` but not `repositories:read` cannot learn
 * a numeric id, and would otherwise hold a scope it can never use.
 */
export type RepositorySelector = { repositoryId: number } | { owner: string; name: string };

export type PullRequestReadError =
  | RepositoryReadError
  /** Not connected, or connected by somebody else — the caller cannot tell which. */
  | 'repository_not_found'
  /** The repository is the caller's, but its GitHub App installation did not resolve. */
  | 'github_unreachable'
  | 'pull_request_not_found'
  /** GitHub refused the read for rate limiting — worth retrying later. */
  /**
   * The owner and name matched more than one accessible repository. Carries
   * the candidates, because `list_repositories` — the only other way to learn
   * an id — is gated on a scope this caller may not hold.
   */
  | { ambiguous: readonly number[] }
  | 'github_rate_limited'
  /** GitHub failed the read for some other reason — permissions, an outage. */
  | 'github_read_failed';

export type PullRequestListResult =
  | {
      ok: true;
      repositoryId: number;
      pullRequests: McpPullRequestSummary[];
      page: number;
      perPage: number;
      hasNextPage: boolean;
    }
  | { ok: false; error: PullRequestReadError };

export type PullRequestDetailResult =
  | { ok: true; repositoryId: number; pullRequest: McpPullRequestDetail }
  | { ok: false; error: PullRequestReadError };

/**
 * The columns of `pull_request_state` this scope may read, named one by one.
 *
 * A bare `.select()` would return the whole row and leave the exclusion to
 * whoever assembles the response — which reads as a projection but is not one:
 * the automation columns still cross the database boundary into the process,
 * where a log line, a query trace, or a later object spread can surface them.
 * Naming the columns keeps the withheld data in PostgreSQL, and
 * `pull-request-reader.test.ts` asserts against the SQL this produces, so the
 * guarantee is checked where it is made rather than at the far end of the
 * response.
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
 * Builds the stored-state query, exported so a test can read the SQL it
 * generates.
 *
 * Asserting on the projection object alone would not have been a regression
 * test: reverting the query to a bare `.select()` leaves that object exported
 * and unchanged, so the assertion passes while every withheld column is being
 * read again. The SQL is the thing that has to be checked, because the SQL is
 * what decides which columns leave the database.
 */
export function selectStoredPullRequestState(repositoryId: number, pullRequestNumber: number) {
  return db
    .select(pullRequestStateProjection)
    .from(pullRequestState)
    .where(
      and(
        eq(pullRequestState.repositoryId, repositoryId),
        eq(pullRequestState.prNumber, pullRequestNumber),
      ),
    );
}

/**
 * Resolves the repository through the caller's own access, then builds a client
 * for *that* installation.
 *
 * Two separate hazards, and the second is easy to miss after fixing the first.
 *
 * `getInstallationForRepository` takes a repository identifier and no user
 * identifier, so resolving it first and checking access afterwards would hand
 * any scope-bearing caller an installation client for a repository somebody
 * else connected. Tribunal's own route is safe for exactly this reason: it
 * authorizes first.
 *
 * But authorizing first is not enough on its own. That function picks an
 * installation from the repository's link rows globally, and a repository can
 * carry links for more than one — a transfer that left the old link behind is
 * the ordinary way it happens. The caller could then be authorized through the
 * installation it can reach while the client is built for a different one,
 * which is a cross-account read assembled out of two individually correct
 * steps. Using the installation that granted access closes that, and removes a
 * second resolution nothing needed.
 */
async function resolveAuthorizedRepository(userId: number, selector: RepositorySelector) {
  if ('repositoryId' in selector) {
    const accessible = await findAccessibleRepository(userId, selector.repositoryId);
    if (!accessible.ok) return { ok: false, error: accessible.error } as const;
    if (!accessible.repository) return { ok: false, error: 'repository_not_found' } as const;
    return { ok: true, repository: accessible.repository } as const;
  }

  const matched = await findAccessibleRepositoriesByName(userId, selector.owner, selector.name);
  if (!matched.ok) return { ok: false, error: matched.error } as const;
  if (matched.matches.length === 0) return { ok: false, error: 'repository_not_found' } as const;
  // Two accessible rows can share an owner and name. Answering for either one
  // would be a guess the caller never made, and it would surface as the wrong
  // pull requests under a repository id they did not send.
  if (matched.matches.length > 1) {
    // Naming the candidates is the recovery. Telling a caller to "send
    // repositoryId" is a dead end when the only tool that lists ids requires
    // `repositories:read`, which is separately refusable — and these ids are
    // already returned by every successful call in this family.
    return {
      ok: false,
      error: { ambiguous: matched.matches.map((repository) => repository.id) },
    } as const;
  }

  return { ok: true, repository: matched.matches[0] as McpRepository } as const;
}

async function resolveAuthorizedInstallation(userId: number, selector: RepositorySelector) {
  const authorized = await resolveAuthorizedRepository(userId, selector);
  if (!authorized.ok) return { ok: false, error: authorized.error } as const;

  const { id: repositoryId, owner, name, installationId } = authorized.repository;

  // Minting an installation token is itself a GitHub call, and it fails the
  // same ways a read does — a rate limit, a 5xx, a revoked installation. Left
  // outside the classification the two service calls already have, those
  // failures escaped the tool boundary as a generic internal error.
  let octokit;
  try {
    octokit = await githubContext.getInstallationOctokit(installationId);
  } catch (error) {
    return { ok: false, error: classifyGitHubFailure(error) } as const;
  }
  if (!octokit) return { ok: false, error: 'github_unreachable' } as const;

  return { ok: true, repositoryId, octokit, owner, repo: name } as const;
}

/**
 * Turns a thrown GitHub failure into an error the caller can act on.
 *
 * The shared service throws on a 403, a 429, or a 5xx, and an uncaught throw
 * leaves the tool boundary as a generic internal failure — which tells a
 * client nothing about whether to wait and retry, ask the user to check an
 * installation, or stop. Rate limiting is separated from everything else
 * because it is the one case where retrying later is exactly right.
 */
function classifyGitHubFailure(error: unknown): PullRequestReadError {
  return isRateLimitError(error) ? 'github_rate_limited' : 'github_read_failed';
}

function summarize(pullRequest: {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  author: { login: string } | null;
  headRef: string;
  headSha: string;
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
    headSha: pullRequest.headSha,
    baseRef: pullRequest.baseRef,
    htmlUrl: pullRequest.htmlUrl,
    updatedAt: pullRequest.updatedAt,
    mergedAt: pullRequest.mergedAt,
  };
}

export async function listRepositoryPullRequests(
  userId: number,
  input: {
    repository: RepositorySelector;
    state: PullRequestFilterState;
    page: number;
    perPage: number;
  },
): Promise<PullRequestListResult> {
  const installation = await resolveAuthorizedInstallation(userId, input.repository);
  if (!installation.ok) return { ok: false, error: installation.error };

  let result;
  try {
    result = await listPullRequests(
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
      installation.repositoryId,
    );
  } catch (error) {
    return { ok: false, error: classifyGitHubFailure(error) };
  }

  return {
    ok: true,
    // Echoed so a client that resolved the repository by name learns its id
    // and can address it directly next time.
    repositoryId: installation.repositoryId,
    pullRequests: result.pullRequests.map(summarize),
    page: input.page,
    perPage: input.perPage,
    hasNextPage: result.hasNextPage,
  };
}

export async function getRepositoryPullRequest(
  userId: number,
  input: { repository: RepositorySelector; pullRequestNumber: number },
): Promise<PullRequestDetailResult> {
  const installation = await resolveAuthorizedInstallation(userId, input.repository);
  if (!installation.ok) return { ok: false, error: installation.error };

  let detail;
  try {
    detail = await getPullRequest(
      githubContext,
      installation.octokit,
      installation.owner,
      installation.repo,
      input.pullRequestNumber,
    );
  } catch (error) {
    return { ok: false, error: classifyGitHubFailure(error) };
  }
  if (!detail) return { ok: false, error: 'pull_request_not_found' };

  const [storedState] = await selectStoredPullRequestState(
    installation.repositoryId,
    input.pullRequestNumber,
  );

  return {
    ok: true,
    repositoryId: installation.repositoryId,
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
            describesCurrentHead: storedState.headSha === detail.headSha,
          }
        : null,
    },
  };
}
