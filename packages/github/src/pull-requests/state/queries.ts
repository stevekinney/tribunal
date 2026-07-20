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
  /**
   * True when pagination stopped early because the caller-supplied budget
   * ran out before every page of check runs (and, for branch reads,
   * commit-status contexts) was fetched — the rollup is incomplete and
   * must not be treated as a trustworthy `passing`/`pending` verdict, nor
   * cached as if it were complete.
   */
  truncated: boolean;
}

type CheckRunSummary = Pick<CIState, 'ciStatus' | 'checkCount' | 'failingCount' | 'truncated'>;

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
 *
 * `includeStatusContexts` additionally rolls in legacy commit-status
 * contexts (the pre-Checks-API `status` API), which some repositories still
 * use as required CI alongside or instead of check runs. It defaults to
 * `false` so the pull-request-head CI path (`getFailingCheckCount`, called
 * without a budget) keeps its existing single-source-of-truth behavior and
 * request shape; only the default-branch path opts in.
 */
async function paginateCheckRunsRollup(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
  budget?: CheckRunBudget,
  includeStatusContexts = false,
  requiredCheckNames?: ReadonlySet<string>,
): Promise<CheckRunSummary> {
  const perPage = 100;
  let page = 1;
  let totalCount = 0;
  let fetchedCount = 0;
  let failingCount = 0;
  let hasError = false;
  let hasPending = false;
  let truncated = false;

  // When the branch defines required status checks, narrow the rollup to just
  // those so a non-required workflow (a deploy or release job) can't flip the
  // default-branch verdict red. With no required checks the set is empty and
  // every check run counts, preserving the prior "any failure fails" behavior.
  //
  // Known limitations (safe by fallback, not handled here): required checks are
  // matched by name only, so an `app_id`-pinned requirement accepts any provider
  // with that name; and required checks defined via GitHub *rulesets* (rather
  // than classic branch protection) are not surfaced by `getBranch`, so those
  // repositories fall back to counting every check.
  const filterToRequired = requiredCheckNames !== undefined && requiredCheckNames.size > 0;
  // Track which required checks actually reported on this commit. A required
  // check that never appears is "expected"/pending on GitHub — treating its
  // absence as passing would show green while a required check is still missing.
  const seenRequired = new Set<string>();
  let matchedCheckCount = 0;
  let matchedStatusCount = 0;

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
      if (filterToRequired && !requiredCheckNames.has(run.name)) {
        continue;
      }
      matchedCheckCount += 1;
      seenRequired.add(run.name);
      if (run.status !== 'completed') {
        hasPending = true;
        continue;
      }
      // Octokit's `checks.listForRef` response type omits `stale` from the
      // conclusion union, but GitHub's Checks API can and does report it
      // (a previously-completed run GitHub has invalidated, e.g. after the
      // base branch moved) — widen to `string` so that real-world value
      // isn't silently missed just because the generated type lags the API.
      const conclusion = run.conclusion as string | null;
      if (conclusion === 'failure') {
        failingCount++;
      } else if (
        conclusion === 'cancelled' ||
        conclusion === 'timed_out' ||
        conclusion === 'action_required' ||
        conclusion === 'stale'
      ) {
        // `action_required` (e.g. a check waiting on manual approval) and
        // `stale` are not passing signals — roll them up as an error
        // alongside cancelled/timed-out runs rather than silently falling
        // through to `passing`.
        hasError = true;
      }
    }

    fetchedCount += data.check_runs.length;

    // Once every required check has reported, stop paging: the remaining
    // (non-required) check runs can't change the verdict, and paging through
    // them spends shared `ApiBudget` for nothing — potentially exhausting it
    // and forcing a false `unknown` on a branch with many non-required runs.
    if (filterToRequired && seenRequired.size >= requiredCheckNames.size) {
      break;
    }

    // Stop once every check run GitHub reported (`total_count`) has been
    // fetched. Relying only on "this page came back short" leaves a repo
    // with exactly `N * perPage` check runs assuming another page exists;
    // with a tight budget, that spends the last allowed unit on an empty
    // page and reports `unknown` instead of the actual complete rollup.
    if (data.check_runs.length < perPage || fetchedCount >= totalCount) {
      break;
    }

    page += 1;
  }

  // When filtering, the combined-status request is only needed if a required
  // check might be a legacy status context we haven't already seen as a check
  // run — skip it (and its budget unit) once every required check has reported.
  const allRequiredSeen = filterToRequired && seenRequired.size >= requiredCheckNames.size;
  let statusTotalCount = 0;
  if (includeStatusContexts && !truncated && !allRequiredSeen) {
    if (budget && !budget.canSpend(1)) {
      truncated = true;
    } else {
      budget?.spend(1);
      const { data: combined } = await octokit.rest.repos.getCombinedStatusForRef({
        owner,
        repo,
        ref,
      });
      statusTotalCount = combined.total_count;
      // An empty status-context set reports an aggregate `state` of
      // "pending" even though there is nothing to be pending on — gate
      // every contribution on there actually being statuses, or a
      // check-run-only repository would flip from `passing` to `pending`.
      if (statusTotalCount > 0) {
        if (filterToRequired) {
          // Aggregate `combined.state` covers every context, so when filtering
          // we must inspect each status and count only the required contexts.
          for (const status of combined.statuses) {
            if (!requiredCheckNames.has(status.context)) continue;
            matchedStatusCount += 1;
            seenRequired.add(status.context);
            if (status.state === 'failure') failingCount++;
            else if (status.state === 'error') hasError = true;
            else if (status.state === 'pending') hasPending = true;
          }
        } else if (combined.state === 'failure') {
          failingCount++;
        } else if (combined.state === 'error') {
          hasError = true;
        } else if (combined.state === 'pending') {
          hasPending = true;
        }
      }
    }
  }

  // A required check that never reported on this commit is still pending on
  // GitHub — don't let the other required checks passing report green while one
  // is missing. Skip when truncated: an unfetched page, not a missing check,
  // could be why we didn't see it, and truncation already yields `unknown`.
  if (filterToRequired && !truncated) {
    for (const requiredName of requiredCheckNames) {
      if (!seenRequired.has(requiredName)) {
        hasPending = true;
        break;
      }
    }
  }

  const effectiveCheckCount = filterToRequired ? matchedCheckCount : totalCount;
  const effectiveStatusCount = filterToRequired ? matchedStatusCount : statusTotalCount;

  let ciStatus: CIStatus;
  if (failingCount > 0) {
    ciStatus = 'failing';
  } else if (hasError) {
    ciStatus = 'error';
  } else if (truncated) {
    // Only an already-observed failure/error above may override truncation.
    // A pending or passing verdict built from an incomplete page set isn't
    // trustworthy for a repository with more check runs (or status
    // contexts) than the budget allowed us to read.
    ciStatus = 'unknown';
  } else if (hasPending) {
    ciStatus = 'pending';
  } else if (effectiveCheckCount > 0 || effectiveStatusCount > 0) {
    ciStatus = 'passing';
  } else {
    ciStatus = 'unknown';
  }

  return {
    ciStatus,
    checkCount: effectiveCheckCount + effectiveStatusCount,
    failingCount,
    truncated,
  };
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
  /**
   * Stable representation of the required-check set this rollup was filtered by.
   * The cache key is `(owner, repo, branch)`, so without this a change to the
   * branch's required checks (same branch, same commit) would replay a verdict
   * computed against the old set.
   */
  requiredKey: string;
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
  requiredCheckNames?: ReadonlySet<string>,
): Promise<CIState> {
  // Sorted so the key is stable regardless of set iteration order.
  const requiredKey = [...(requiredCheckNames ?? [])].sort().join('\n');
  const fetchCIState = async (): Promise<BranchCIState> => ({
    ...(await paginateCheckRunsRollup(
      octokit,
      owner,
      repo,
      commitSha,
      budget,
      /* includeStatusContexts */ true,
      requiredCheckNames,
    )),
    commitSha,
    requiredKey,
  });

  if (!context) {
    return fetchCIState();
  }

  const policy = requirePolicy('get-branch-ci-status');
  const cacheKey = policy.keyFactory(owner, repo, branch);

  const { value, source } = await cachedRead<BranchCIState>(
    context.cache,
    policy,
    async () => ({ data: await fetchCIState() }),
    [owner, repo, branch],
  );

  // A budget-truncated rollup is incomplete by construction. Letting it sit
  // in the cache would poison later requests — even ones with plenty of
  // budget left — into reusing `unknown` for the remainder of the TTL
  // instead of fetching the complete rollup. Only a freshly-fetched
  // (non-cache-hit) result needs this; a cache hit was already checked when
  // it was written.
  if (value.truncated && source !== 'cache') {
    await context.cache.deleteCache(cacheKey);
  }

  if (value.commitSha === commitSha && value.requiredKey === requiredKey) {
    return value;
  }

  const { value: refreshed, source: refreshedSource } = await cachedRead<BranchCIState>(
    context.cache,
    policy,
    async () => ({ data: await fetchCIState() }),
    [owner, repo, branch],
    { bypass: true },
  );
  if (refreshed.truncated && refreshedSource !== 'cache') {
    await context.cache.deleteCache(cacheKey);
  }
  return refreshed;
}
