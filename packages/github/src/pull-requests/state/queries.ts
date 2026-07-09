import type { Octokit } from 'octokit';
import type { CIStatus, MergeStatus, ReviewStatus } from '@tribunal/database/schema';
import type { GithubServiceContext } from '../../context.js';
import { cachedRead } from '../../core/github-read-client.js';
import { requirePolicy } from '../../core/cache-policy.js';

// ============================================================================
// MERGE STATUS
// ============================================================================

export type { MergeStatus };

/** Map GitHub's `mergeable_state` string to our internal merge status. */
export function mapMergeableState(mergeableState: string | undefined): MergeStatus {
  switch (mergeableState) {
    case 'clean':
      return 'clean';
    case 'dirty':
      return 'conflicts';
    case 'behind':
      return 'behind';
    case 'blocked':
      return 'blocked';
    default:
      return 'unknown';
  }
}

// ============================================================================
// REVIEW STATE
// ============================================================================

interface AggregateReviewState {
  reviewStatus: ReviewStatus;
  approvalCount: number;
  changesRequestedCount: number;
  unresolvedThreadCount: number;
}

/**
 * Fetch aggregate review state for a PR.
 * Makes one REST call for reviews and one GraphQL call for unresolved thread count.
 *
 * @param context - Optional service context. When provided, results are cached via Redis.
 * @param octokit - Authenticated Octokit client
 */
export async function getAggregateReviewState(
  context: GithubServiceContext | undefined,
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<AggregateReviewState> {
  const fetchReviewState = async (): Promise<AggregateReviewState> => {
    // Get all reviews (paginate to handle PRs with > 100 reviews)
    const perPage = 100;
    let page = 1;
    const allReviews: Awaited<ReturnType<typeof octokit.rest.pulls.listReviews>>['data'] = [];

    // Manual pagination to avoid missing reviews on large PRs
    // Stops when a page returns fewer than perPage reviews.
    // NOTE: This keeps behavior consistent while lifting the 100-review limit.
    while (true) {
      const { data } = await octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber,
        per_page: perPage,
        page,
      });

      allReviews.push(...data);

      if (data.length < perPage) {
        break;
      }

      page += 1;
    }

    // De-duplicate: keep only the latest review per user
    const latestByUser = new Map<number, string>();
    for (const review of allReviews) {
      if (!review.user?.id || !review.state) continue;
      // Later reviews in the array are more recent
      latestByUser.set(review.user.id, review.state);
    }

    let approvalCount = 0;
    let changesRequestedCount = 0;
    for (const state of latestByUser.values()) {
      if (state === 'APPROVED') approvalCount++;
      if (state === 'CHANGES_REQUESTED') changesRequestedCount++;
    }

    // Determine overall review status
    let reviewStatus: ReviewStatus = 'pending';
    if (changesRequestedCount > 0) {
      reviewStatus = 'changes_requested';
    } else if (approvalCount > 0) {
      reviewStatus = 'approved';
    }

    // Get unresolved thread count via GraphQL
    let unresolvedThreadCount = 0;
    try {
      let cursor: string | null = null;

      type GraphQLResponse = {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: Array<{ isResolved: boolean }>;
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
            };
          };
        };
      };

      do {
        const graphqlResponse: GraphQLResponse = await octokit.graphql<GraphQLResponse>(
          `query($owner: String!, $repo: String!, $prNumber: Int!, $after: String) {
            repository(owner: $owner, name: $repo) {
              pullRequest(number: $prNumber) {
                reviewThreads(first: 100, after: $after) {
                  nodes { isResolved }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }
          }`,
          { owner, repo, prNumber, after: cursor },
        );

        const { nodes, pageInfo } = graphqlResponse.repository.pullRequest.reviewThreads;
        unresolvedThreadCount += nodes.filter((t: { isResolved: boolean }) => !t.isResolved).length;

        cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
      } while (cursor);
    } catch (error) {
      // Non-critical — proceed with 0. Log for observability.
      console.error('[github-cache] getAggregateReviewState GraphQL thread count failed:', error);
    }

    return { reviewStatus, approvalCount, changesRequestedCount, unresolvedThreadCount };
  };

  if (!context) {
    return fetchReviewState();
  }

  const policy = requirePolicy('get-aggregate-review-state');
  const { value } = await cachedRead<AggregateReviewState>(
    context.cache,
    policy,
    async () => ({ data: await fetchReviewState() }),
    [owner, repo, prNumber],
  );
  return value;
}

// ============================================================================
// CI STATE
// ============================================================================

interface CIState {
  ciStatus: CIStatus;
  checkCount: number;
  failingCount: number;
}

type CheckRunSummary = Pick<CIState, 'ciStatus' | 'checkCount' | 'failingCount'>;

/**
 * Minimal shape `paginateCheckRunsRollup` needs from a caller-provided call
 * budget. Kept structural (rather than importing `ApiBudget` from the
 * dashboard module) so this state-query module doesn't take a dependency on
 * the dashboard feature.
 */
export interface CheckRunBudget {
  canSpend(cost?: number): boolean;
  spend(cost?: number): void;
}

/**
 * Paginate through GitHub check runs for a ref and roll them up into a single
 * {@link CIStatus}. Shared by pull-request-head CI reads and default-branch
 * CI reads so the "what counts as failing/error/pending/passing" state
 * machine only exists once.
 *
 * When `budget` is supplied, each page fetched (not just the first) spends
 * one unit against it. Repositories with large CI matrices otherwise consume
 * many live GitHub requests while a caller-side budget records only one,
 * defeating the fan-out cap that budget exists to enforce. If the budget
 * runs out mid-pagination, the rollup is marked `truncated` and reports
 * `unknown` rather than a possibly-incomplete `passing`/`pending` verdict —
 * a failing/error signal already observed in fetched pages still wins.
 */
async function paginateCheckRunsRollup(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
  budget?: CheckRunBudget,
): Promise<CheckRunSummary> {
  const perPage = 100;
  let page = 1;
  let totalCount = 0;
  let failingCount = 0;
  let hasError = false;
  let hasPending = false;
  let truncated = false;

  while (true) {
    if (budget) {
      if (!budget.canSpend(1)) {
        truncated = true;
        break;
      }
      budget.spend(1);
    }

    const { data } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref,
      per_page: perPage,
      page,
    });

    if (page === 1) {
      totalCount = data.total_count;
    }

    for (const run of data.check_runs) {
      if (run.status !== 'completed') {
        hasPending = true;
        continue;
      }
      if (run.conclusion === 'failure') {
        failingCount++;
      } else if (
        run.conclusion === 'cancelled' ||
        run.conclusion === 'timed_out' ||
        run.conclusion === 'action_required'
      ) {
        // `action_required` (e.g. a check waiting on manual approval) is not
        // a passing signal — roll it up as an error alongside cancelled/
        // timed-out runs rather than silently falling through to `passing`.
        hasError = true;
      }
    }

    if (data.check_runs.length < perPage) {
      break;
    }

    page += 1;
  }

  let ciStatus: CIStatus;
  if (failingCount > 0) {
    ciStatus = 'failing';
  } else if (hasError) {
    ciStatus = 'error';
  } else if (hasPending) {
    ciStatus = 'pending';
  } else if (truncated) {
    ciStatus = 'unknown';
  } else if (totalCount > 0) {
    ciStatus = 'passing';
  } else {
    ciStatus = 'unknown';
  }

  return { ciStatus, checkCount: totalCount, failingCount };
}

/**
 * Get CI status from check runs for a commit SHA.
 *
 * @param context - Optional service context. When provided, results are cached via Redis.
 * @param octokit - Authenticated Octokit client
 */
export async function getFailingCheckCount(
  context: GithubServiceContext | undefined,
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
): Promise<CIState> {
  const fetchCIState = () => paginateCheckRunsRollup(octokit, owner, repo, headSha);

  if (!context) {
    return fetchCIState();
  }

  const policy = requirePolicy('get-failing-check-count');
  const { value } = await cachedRead<CIState>(
    context.cache,
    policy,
    async () => ({ data: await fetchCIState() }),
    [owner, repo, headSha],
  );
  return value;
}

// ============================================================================
// DEFAULT-BRANCH CI STATE
// ============================================================================

interface BranchCIState extends CIState {
  /** Commit SHA this rollup was computed for — used to detect a stale cross-commit cache hit. */
  commitSha: string;
}

/**
 * Get the continuous integration rollup for a repository's default branch.
 *
 * Reads check runs for the branch's known head commit SHA — never the
 * branch name — so the result reflects a specific, citable commit rather
 * than "whatever HEAD is right now" at read time. Callers must resolve
 * `defaultBranch` and `commit` before calling; this function does not
 * fall back to guessing `main` or re-resolving a missing SHA.
 *
 * Cached under the `get-branch-ci-status` policy, keyed by
 * `(owner, repo, branch)` — distinct from the PR-head CI cache key, which
 * is keyed by `(owner, repo, headSha)`. Because the cache key does not
 * include the commit SHA, a cached entry from before the default branch
 * advanced would otherwise be replayed for the new commit. The cached
 * envelope stores the commit SHA it was computed for; a mismatch bypasses
 * the cache and refetches for the requested SHA instead of silently
 * reusing a different commit's rollup.
 */
export async function getDefaultBranchCiStatus(
  context: GithubServiceContext | undefined,
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  commitSha: string,
  budget?: CheckRunBudget,
): Promise<CIState> {
  const fetchCIState = async (): Promise<BranchCIState> => ({
    ...(await paginateCheckRunsRollup(octokit, owner, repo, commitSha, budget)),
    commitSha,
  });

  if (!context) {
    return fetchCIState();
  }

  const policy = requirePolicy('get-branch-ci-status');
  const { value } = await cachedRead<BranchCIState>(
    context.cache,
    policy,
    async () => ({ data: await fetchCIState() }),
    [owner, repo, branch],
  );

  if (value.commitSha === commitSha) {
    return value;
  }

  const { value: refreshed } = await cachedRead<BranchCIState>(
    context.cache,
    policy,
    async () => ({ data: await fetchCIState() }),
    [owner, repo, branch],
    { bypass: true },
  );
  return refreshed;
}
