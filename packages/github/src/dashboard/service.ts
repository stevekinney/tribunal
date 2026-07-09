/**
 * Dashboard read-model service.
 *
 * Builds repository/pull-request overview rows for already-authorized
 * repositories. This module never re-derives user authorization — callers
 * (route loaders) resolve the accessible repository set first (e.g. via
 * `getRepositoriesForUser`) and pass it in.
 *
 * Data-source contract (projection-first path, locked in the Phase Two
 * plan):
 *
 * - Pull request *inventory* (which PRs are open) comes from a live REST
 *   `listPullRequests` call per repository — GitHub is authoritative here.
 * - Attention *signals* (`ciStatus`, `mergeStatus`, `unresolvedThreadCount`)
 *   come from the `pull_request_state` projection, each with its own
 *   freshness timestamp. A missing or stale signal renders `unknown`
 *   (or `null` for counts) — never a guessed value, and never a live
 *   GraphQL call from this code path.
 * - Default-branch continuous integration is a separate, live GitHub read
 *   (`getDefaultBranchCiStatus`), never conflated with pull-request-head CI.
 *
 * All live GitHub fan-out is bounded by a single `ApiBudget` for the whole
 * build. Once the budget is exhausted, or GitHub reports a rate limit,
 * remaining repositories render as `unavailable` instead of issuing more
 * requests.
 */
import type { GithubServiceContext } from '../context.js';
import { isRateLimitError } from '../errors.js';
import { listPullRequests, type PullRequestFilterOptions } from '../pull-requests/service.js';
import { getDefaultBranchCiStatus } from '../pull-requests/state/queries.js';
import { listPRStatesForRepositories } from '../pull-requests/state/state.js';
import type { PullRequestState } from '@tribunal/database/schema';
import { ApiBudget, DEFAULT_DASHBOARD_API_BUDGET } from './api-budget.js';
import {
  pullRequestNeedsAttention,
  type BranchCIStatus,
  type DashboardOptions,
  type DashboardRepositoryIdentity,
  type DashboardUnavailableReason,
  type PullRequestDashboardRow,
  type RepositoryDashboardRow,
} from './types.js';

export * from './types.js';
export { ApiBudget, DEFAULT_DASHBOARD_API_BUDGET } from './api-budget.js';

/** Cached decoration older than this renders as `unknown` rather than reused. */
export const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

/** GitHub caps `pulls.list` at 100 items per page; more requires a second page. */
const OPEN_PULL_REQUEST_PAGE_SIZE = 100;

const DASHBOARD_PULL_REQUEST_FILTERS: PullRequestFilterOptions = {
  state: 'open',
  sort: 'updated',
  direction: 'desc',
  page: 1,
  perPage: OPEN_PULL_REQUEST_PAGE_SIZE,
};

/**
 * Build one dashboard row per authorized repository.
 *
 * Repositories are processed sequentially (not concurrently) so the shared
 * `ApiBudget` bounds fan-out deterministically: once exhausted, every
 * remaining repository short-circuits to an `unavailable` row without
 * attempting further GitHub calls.
 */
export async function buildRepositoryDashboard(
  context: GithubServiceContext,
  repositories: DashboardRepositoryIdentity[],
  options: DashboardOptions = {},
): Promise<RepositoryDashboardRow[]> {
  const budget = new ApiBudget(options.apiBudget ?? DEFAULT_DASHBOARD_API_BUDGET);
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const now = options.now ?? (() => new Date());

  const rows: RepositoryDashboardRow[] = [];
  for (const repository of repositories) {
    rows.push(await buildRepositoryRow(context, repository, budget, staleAfterMs, now()));
  }
  return rows;
}

async function buildRepositoryRow(
  context: GithubServiceContext,
  repository: DashboardRepositoryIdentity,
  budget: ApiBudget,
  staleAfterMs: number,
  now: Date,
): Promise<RepositoryDashboardRow> {
  const refreshedAt = now.toISOString();
  const identity = {
    id: repository.id,
    owner: repository.owner,
    name: repository.name,
    defaultBranch: repository.defaultBranch,
    htmlUrl: repository.htmlUrl,
  };

  const budgetSnapshot = budget.snapshot;
  if (budgetSnapshot.exhausted) {
    return unavailableRow(
      identity,
      refreshedAt,
      budgetSnapshot.exhaustedReason === 'rate-limit' ? 'rate-limited' : 'api-budget-exhausted',
    );
  }

  if (!repository.installationId) {
    return unavailableRow(identity, refreshedAt, 'no-installation');
  }

  let octokit: Awaited<ReturnType<GithubServiceContext['getInstallationOctokit']>>;
  try {
    octokit = await context.getInstallationOctokit(repository.installationId);
  } catch (error) {
    // A thrown error means installation-token resolution itself failed
    // (e.g. a 403/429 while minting the token, or a transient GitHub
    // error) — distinct from `getInstallationOctokit` returning `null` for
    // a genuinely missing installation. Reporting this as `no-installation`
    // would make the dashboard keep retrying token resolution on every
    // load instead of short-circuiting on the rate limit / surfacing the
    // real failure.
    if (isRateLimitError(error)) budget.markRateLimited();
    return unavailableRow(
      identity,
      refreshedAt,
      isRateLimitError(error) ? 'rate-limited' : 'github-error',
    );
  }
  if (!octokit) {
    return unavailableRow(identity, refreshedAt, 'no-installation');
  }

  // Inventory: GitHub is authoritative. Always pass repositoryId so this
  // read goes through `cachedRead` rather than its uncached bypass path.
  budget.spend(1);
  let pullRequests: Awaited<ReturnType<typeof listPullRequests>>['pullRequests'];
  try {
    const result = await listPullRequests(
      context,
      octokit,
      repository.owner,
      repository.name,
      DASHBOARD_PULL_REQUEST_FILTERS,
      repository.id,
    );
    pullRequests = result.pullRequests;
  } catch (error) {
    if (isRateLimitError(error)) budget.markRateLimited();
    return unavailableRow(
      identity,
      refreshedAt,
      isRateLimitError(error) ? 'rate-limited' : 'github-error',
    );
  }

  const defaultBranchStatus = await readDefaultBranchStatus(context, octokit, repository, budget);

  const stateMap = await listPRStatesForRepositories(
    context,
    pullRequests.map((pullRequest) => ({
      repositoryId: repository.id,
      prNumber: pullRequest.number,
    })),
  );
  const nowMs = now.getTime();
  const dashboardPullRequests = pullRequests.map((pullRequest) =>
    decoratePullRequest(
      repository.id,
      pullRequest,
      stateMap.get(`${repository.id}:${pullRequest.number}`),
      nowMs,
      staleAfterMs,
    ),
  );

  const attentionPullRequestCount = dashboardPullRequests.filter(pullRequestNeedsAttention).length;
  const unresolvedThreadCount = dashboardPullRequests.reduce(
    (sum, pullRequest) => sum + (pullRequest.unresolvedThreadCount ?? 0),
    0,
  );

  return {
    repository: identity,
    defaultBranchStatus,
    openPullRequestCount: dashboardPullRequests.length,
    openPullRequestCountAtCap: dashboardPullRequests.length >= OPEN_PULL_REQUEST_PAGE_SIZE,
    attentionPullRequestCount,
    unresolvedThreadCount,
    pullRequests: dashboardPullRequests,
    refreshedAt,
    dataStatus: 'ok',
  };
}

async function readDefaultBranchStatus(
  context: GithubServiceContext,
  octokit: NonNullable<Awaited<ReturnType<GithubServiceContext['getInstallationOctokit']>>>,
  repository: DashboardRepositoryIdentity,
  budget: ApiBudget,
): Promise<BranchCIStatus> {
  // Missing defaultBranch or commit renders `unknown` — never assume `main`.
  if (!repository.defaultBranch || !repository.commit) {
    return 'unknown';
  }

  try {
    // No budget pre-check here: a cached, fresh envelope for this branch
    // costs nothing to serve even when the budget is otherwise exhausted,
    // and denying the cache lookup up front would degrade an
    // already-available answer to `unknown` for no reason. Budget
    // accounting happens per-page inside `getDefaultBranchCiStatus` (via the
    // shared check-run paginator) — on a cache miss, its own
    // `budget.canSpend(1)` guard still stops the first live fetch and
    // reports `unknown` rather than spending anything. A repository with a
    // large CI matrix otherwise consumes many live GitHub requests while
    // this budget records only one, defeating the fan-out cap.
    const ciState = await getDefaultBranchCiStatus(
      context,
      octokit,
      repository.owner,
      repository.name,
      repository.defaultBranch,
      repository.commit,
      budget,
    );
    return ciState.ciStatus;
  } catch (error) {
    if (isRateLimitError(error)) budget.markRateLimited();
    return 'unknown';
  }
}

function decoratePullRequest(
  repositoryId: number,
  pullRequest: {
    number: number;
    title: string;
    htmlUrl: string;
    author: { login: string; htmlUrl: string } | null;
    draft: boolean;
    headRef: string;
    baseRef: string;
    headSha: string;
    updatedAt: string;
  },
  state: PullRequestState | undefined,
  nowMs: number,
  staleAfterMs: number,
): PullRequestDashboardRow {
  // A PR receiving a new commit shortly after checks finished on the
  // previous head would otherwise still look "fresh" by wall-clock alone —
  // `synchronize` updates the PR's head but the previous ciStatus/
  // ciUpdatedAt can linger until the next CI webhook lands. Require the
  // projection's recorded head SHA to match the PR's *current* head before
  // trusting its CI decoration; a mismatch renders `unknown` rather than
  // replaying stale CI for the new commit.
  const ciFresh =
    isFresh(state?.ciUpdatedAt, nowMs, staleAfterMs) && state?.headSha === pullRequest.headSha;
  const mergeFresh = isFresh(state?.mergeUpdatedAt, nowMs, staleAfterMs);
  const reviewFresh = isFresh(state?.reviewUpdatedAt, nowMs, staleAfterMs);

  return {
    repositoryId,
    number: pullRequest.number,
    title: pullRequest.title,
    htmlUrl: pullRequest.htmlUrl,
    author: pullRequest.author,
    draft: pullRequest.draft,
    headRef: pullRequest.headRef,
    baseRef: pullRequest.baseRef,
    headSha: pullRequest.headSha,
    ciStatus: ciFresh && state ? state.ciStatus : 'unknown',
    ciUpdatedAt: state?.ciUpdatedAt ? state.ciUpdatedAt.toISOString() : null,
    mergeStatus: mergeFresh && state ? state.mergeStatus : 'unknown',
    mergeUpdatedAt: state?.mergeUpdatedAt ? state.mergeUpdatedAt.toISOString() : null,
    unresolvedThreadCount: reviewFresh && state ? state.unresolvedThreadCount : null,
    reviewUpdatedAt: state?.reviewUpdatedAt ? state.reviewUpdatedAt.toISOString() : null,
    updatedAt: pullRequest.updatedAt,
  };
}

function isFresh(updatedAt: Date | null | undefined, nowMs: number, staleAfterMs: number): boolean {
  if (!updatedAt) return false;
  return nowMs - updatedAt.getTime() <= staleAfterMs;
}

function unavailableRow(
  repository: RepositoryDashboardRow['repository'],
  refreshedAt: string,
  reason: DashboardUnavailableReason,
): RepositoryDashboardRow {
  return {
    repository,
    defaultBranchStatus: 'unknown',
    openPullRequestCount: null,
    openPullRequestCountAtCap: false,
    attentionPullRequestCount: null,
    unresolvedThreadCount: null,
    pullRequests: [],
    refreshedAt,
    dataStatus: 'unavailable',
    unavailableReason: reason,
  };
}
