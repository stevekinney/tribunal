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
import { requirePolicy } from '../core/cache-policy.js';
import { cachedRead } from '../core/github-read-client.js';
import { isRateLimitError } from '../errors.js';
import { resolveHasNextPage } from '@tribunal/github/shared';
import { listPullRequests, type PullRequestFilterOptions } from '../pull-requests/service.js';
import { getDefaultBranchCiStatus, type RequiredCheck } from '../pull-requests/state/queries.js';
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

/** The cached default-branch head: its commit SHA plus the branch's required checks. */
type BranchHead = { sha: string; requiredChecks: RequiredCheck[] };

/** The pre-#156 cached envelope shape, still possibly live in cache for up to one TTL after deploy. */
type LegacyBranchHead = { sha: string; requiredCheckNames?: string[] };

/** Reads either envelope shape, converting legacy `requiredCheckNames` (all unpinned) if present. */
function normalizeCachedRequiredChecks(value: BranchHead | LegacyBranchHead): RequiredCheck[] {
  if ('requiredChecks' in value && Array.isArray(value.requiredChecks)) {
    return value.requiredChecks;
  }
  if ('requiredCheckNames' in value && Array.isArray(value.requiredCheckNames)) {
    return value.requiredCheckNames.map((context) => ({ context, appId: null }));
  }
  return [];
}

/**
 * De-duplicates required checks by `context`, preferring an app-pinned entry
 * over an unpinned one for the same context. Two sources can each name the
 * same context differently pinned — classic protection's `contexts` (always
 * unpinned) mirrors its own `checks[]` (possibly pinned), and separately a
 * ruleset can pin a context that classic protection left unpinned (or vice
 * versa). If both an unpinned and a pinned entry for the same context
 * survived, `findRequiredCheckRunMatch` would match the (looser) unpinned
 * entry first for any same-named check run, permanently starving the pinned
 * entry of a match and reporting it as "missing" even after a matching
 * check run from the required app reported. Two *distinct* pinned entries
 * for the same context (different `appId`) are each kept, as separate
 * requirements.
 */
function dedupeRequiredChecks(checks: RequiredCheck[]): RequiredCheck[] {
  const pinnedContexts = new Set<string>();
  for (const check of checks) {
    if (check.appId !== null) pinnedContexts.add(check.context);
  }

  const seen = new Set<string>();
  const result: RequiredCheck[] = [];
  for (const check of checks) {
    if (check.appId === null && pinnedContexts.has(check.context)) continue;
    const key = `${check.context}::${check.appId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(check);
  }
  return result;
}

/**
 * Collects a branch's required status checks from a `getBranch` response —
 * both the legacy `contexts` list (unpinned) and the newer `checks[]` entries
 * (optionally pinned to a GitHub App via `app_id`). GitHub uses `app_id: -1`
 * as a sentinel for "accept from any source" — normalized to `null` here so
 * downstream matching only ever sees a real app id or "unpinned".
 *
 * GitHub mirrors every `checks[]` entry's context into the legacy `contexts`
 * list for backward compatibility, so a context normally appears in both —
 * `dedupeRequiredChecks` resolves that by preferring the (possibly pinned)
 * `checks[]` entry over its mirrored, always-unpinned `contexts` duplicate.
 *
 * Empty when the branch has no protection or defines no required checks, in
 * which case the CI rollup falls back to counting every check run.
 */
function extractRequiredChecks(branch: {
  protection?: {
    required_status_checks?: {
      contexts?: string[];
      checks?: { context: string; app_id?: number | null }[];
    };
  };
}): RequiredCheck[] {
  const requiredStatusChecks = branch.protection?.required_status_checks;
  if (!requiredStatusChecks) return [];

  const checks: RequiredCheck[] = [];
  for (const context of requiredStatusChecks.contexts ?? []) {
    checks.push({ context, appId: null });
  }
  for (const check of requiredStatusChecks.checks ?? []) {
    const appId = check.app_id === -1 || check.app_id == null ? null : check.app_id;
    checks.push({ context: check.context, appId });
  }
  return dedupeRequiredChecks(checks);
}

/**
 * Result of reading a branch's ruleset-derived required checks.
 *
 * `incomplete: true` means `checks` must not be treated as the full,
 * confident required-check set for this branch — either because a rule type
 * this reader cannot resolve to a check-run/status match was present (a
 * `workflows` rule — see {@link extractRequiredChecksFromRules}), or because
 * the read was cut off before every page of rules was seen (see
 * {@link RulesetBudgetExhaustedError}). Callers must render `unknown` for
 * the branch rather than computing a verdict from a `checks` set that might
 * be silently missing a requirement.
 */
interface RulesetReadResult {
  checks: RequiredCheck[];
  incomplete: boolean;
}

/**
 * Thrown when the `ApiBudget` runs out mid-pagination of `getBranchRules`.
 * Distinct from any other error `getBranchRules` (or its pagination) can
 * throw: a budget exhaustion is this build's own deliberate choice to stop,
 * not evidence that no ruleset applies, so it must propagate as `incomplete`
 * rather than degrade to classic-protection-only required checks. An
 * ordinary GitHub error (rate limit, network failure, rulesets unsupported)
 * still degrades to classic-only, per the existing documented tradeoff.
 */
class RulesetBudgetExhaustedError extends Error {}

/** Reads either the current `RulesetReadResult` cache envelope or a bare `RequiredCheck[]` written by a prior deploy. */
function normalizeCachedRulesetResult(
  value: RulesetReadResult | RequiredCheck[],
): RulesetReadResult {
  if (Array.isArray(value)) return { checks: value, incomplete: false };
  return value;
}

/**
 * Collects required status checks from a repository's rulesets — a
 * `GET .../rules/branches/{branch}` response is a flat array of rules that
 * apply to the branch (org- and repo-level rulesets combined), each
 * discriminated by `type`. Only `required_status_checks` rules contribute
 * an actual check to match against; every other rule type (pull-request
 * requirements, merge-queue, etc.) is irrelevant to the CI rollup and
 * ignored — except `workflows` ("Require workflows to pass"), whose
 * required-check identity (a workflow file path + job, not a check-run
 * `context`/`name`) this reader cannot resolve to a check-run match, so its
 * presence is reported back via `hasWorkflowsRule` instead of being
 * silently dropped.
 *
 * Rulesets pin a required check to an app via `integration_id` — GitHub's
 * ruleset equivalent of classic protection's `checks[].app_id`, without the
 * `-1` sentinel (an absent `integration_id` already means "unpinned").
 */
function extractRequiredChecksFromRules(rules: readonly unknown[]): {
  checks: RequiredCheck[];
  hasWorkflowsRule: boolean;
} {
  const checks: RequiredCheck[] = [];
  let hasWorkflowsRule = false;
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    const { type, parameters } = rule as { type?: unknown; parameters?: unknown };
    if (type === 'workflows') {
      hasWorkflowsRule = true;
      continue;
    }
    if (type !== 'required_status_checks') continue;

    const requiredStatusChecks = (parameters as { required_status_checks?: unknown } | undefined)
      ?.required_status_checks;
    if (!Array.isArray(requiredStatusChecks)) continue;

    for (const requiredStatusCheck of requiredStatusChecks) {
      if (!requiredStatusCheck || typeof requiredStatusCheck !== 'object') continue;
      const { context, integration_id: integrationId } = requiredStatusCheck as {
        context?: unknown;
        integration_id?: unknown;
      };
      if (typeof context !== 'string') continue;
      checks.push({ context, appId: typeof integrationId === 'number' ? integrationId : null });
    }
  }
  return { checks: dedupeRequiredChecks(checks), hasWorkflowsRule };
}

/**
 * Reads required status checks defined via a repository ruleset — invisible
 * to `getBranch`'s `protection.required_status_checks`, which only reflects
 * *classic* branch protection. This is a distinct, separately-cached GitHub
 * request (`get-branch-rules`) rather than being folded into the
 * `get-branch-head-sha` read, so a repository with no ruleset support (or a
 * transient failure) degrades to classic-protection-only required checks
 * instead of failing the whole branch-status read.
 *
 * Not invalidated by `resource-invalidation.ts`: this app doesn't subscribe
 * to a ruleset-change webhook (nor, for that matter, to classic branch
 * protection's edit event — the existing `get-branch-head-sha` required
 * checks already carry the same gap), so an edited ruleset is picked up
 * within this policy's 30s TTL rather than immediately. Subscribing to
 * `repository_ruleset` for immediate invalidation is a separate, larger
 * change (new webhook subscription + schema) outside this fix's scope.
 */
async function readRulesetRequiredChecks(
  context: GithubServiceContext,
  octokit: NonNullable<Awaited<ReturnType<GithubServiceContext['getInstallationOctokit']>>>,
  repository: DashboardRepositoryIdentity,
  budget: ApiBudget,
): Promise<RulesetReadResult> {
  try {
    const policy = requirePolicy('get-branch-rules');
    const { value } = await cachedRead<RulesetReadResult | RequiredCheck[]>(
      context.cache,
      policy,
      async () => {
        // `getBranchRules` is a list endpoint (default page size 30) — a
        // branch with many org/repo rules layered on it can have its
        // `required_status_checks` rule land past page 1, so this pages
        // through the full rule set rather than reading page 1 alone.
        const perPage = 100;
        let page = 1;
        const rules: unknown[] = [];
        while (true) {
          if (!budget.canSpend(1)) {
            // Always throw on budget exhaustion mid-pagination, even after
            // collecting one or more pages — a partial rule set can be
            // missing the very `required_status_checks` rule that would
            // have been on a later page, and `cachedRead` would otherwise
            // cache that *incomplete* (looks-like-"no ruleset checks")
            // result for the full TTL. Throwing routes through the catch
            // below instead, which reports the read as `incomplete` without
            // caching a wrong answer.
            throw new RulesetBudgetExhaustedError(
              'API budget exhausted before resolving branch ruleset required checks',
            );
          }
          budget.spend(1);
          const { data, headers } = await octokit.rest.repos.getBranchRules({
            owner: repository.owner,
            repo: repository.name,
            branch: repository.defaultBranch as string,
            per_page: perPage,
            page,
          });
          rules.push(...data);
          // Rely on the `Link` response header, not page length: applicable
          // rules can exactly fill a `perPage`-sized final page, and a
          // length-only stop condition would then probe a phantom next page
          // — wasting a budget unit (or, under a tighter budget, throwing
          // and dropping the ruleset-derived requirements) for nothing.
          if (!resolveHasNextPage(headers?.link)) break;
          page += 1;
        }
        const { checks, hasWorkflowsRule } = extractRequiredChecksFromRules(rules);
        return { data: { checks, incomplete: hasWorkflowsRule } };
      },
      [repository.owner, repository.name, repository.defaultBranch],
    );
    return normalizeCachedRulesetResult(value);
  } catch (error) {
    if (isRateLimitError(error)) budget.markRateLimited();
    if (error instanceof RulesetBudgetExhaustedError) {
      return { checks: [], incomplete: true };
    }
    // Any other failure (rate limit, network error, rulesets unsupported)
    // degrades to classic-protection-only required checks rather than
    // rendering the whole branch status unavailable — see the module-level
    // comment on `readRulesetRequiredChecks`'s caller for why this differs
    // from the budget-exhaustion case above.
    return { checks: [], incomplete: false };
  }
}

async function readDefaultBranchStatus(
  context: GithubServiceContext,
  octokit: NonNullable<Awaited<ReturnType<GithubServiceContext['getInstallationOctokit']>>>,
  repository: DashboardRepositoryIdentity,
  budget: ApiBudget,
): Promise<BranchCIStatus> {
  // Missing defaultBranch renders `unknown` — never assume `main`.
  if (!repository.defaultBranch) {
    return 'unknown';
  }

  // The stored commit is a projection updated by the push handler and can lag
  // behind GitHub during that asynchronous write. Resolve the branch head
  // through the short-lived cache first so a push invalidation or a synced
  // default-branch change cannot make the dashboard trust the old SHA.
  let commitSha = repository.commit;
  let requiredChecks: RequiredCheck[] = [];
  try {
    const policy = requirePolicy('get-branch-head-sha');
    const { value } = await cachedRead<BranchHead | LegacyBranchHead | string>(
      context.cache,
      policy,
      async () => {
        if (!budget.canSpend(1)) {
          throw new Error('API budget exhausted before resolving branch head SHA');
        }
        budget.spend(1);
        const { data: branch } = await octokit.rest.repos.getBranch({
          owner: repository.owner,
          repo: repository.name,
          branch: repository.defaultBranch as string,
        });
        // Reuse this one call for the classic-protection required checks too,
        // so narrowing the CI rollup to required checks costs no extra
        // GitHub request beyond the one this function already makes.
        return {
          data: { sha: branch.commit.sha, requiredChecks: extractRequiredChecks(branch) },
        };
      },
      [repository.owner, repository.name, repository.defaultBranch],
    );
    // Tolerate a bare-string value, or the pre-#156 envelope shape
    // (`{ sha, requiredCheckNames: string[] }`) cached by a previous build —
    // the 30s TTL clears either quickly, but converting `requiredCheckNames`
    // (as unpinned checks) rather than dropping it avoids a deploy-window
    // regression to the unfiltered "any failure fails" behavior.
    const head: BranchHead =
      typeof value === 'string'
        ? { sha: value, requiredChecks: [] }
        : { sha: value.sha, requiredChecks: normalizeCachedRequiredChecks(value) };
    commitSha = head.sha;
    requiredChecks = head.requiredChecks;
  } catch (error) {
    if (isRateLimitError(error)) budget.markRateLimited();
    if (!commitSha) return 'unknown';
  }

  // Required checks defined via a repository *ruleset* (rather than classic
  // branch protection) are invisible to `getBranch` — read them separately
  // and merge, so a ruleset-only repository doesn't fall back to counting
  // every check run just because `protection.required_status_checks` is
  // empty. Independent of the branch-head read above: it degrades to an
  // empty list (classic-protection-only required checks) on any failure.
  const rulesetResult = await readRulesetRequiredChecks(context, octokit, repository, budget);
  if (rulesetResult.incomplete) {
    // The ruleset-required-check set could not be fully resolved (budget
    // exhaustion mid-pagination, or an unmatchable `workflows` rule) — a
    // merged set built from `requiredChecks` alone here would silently
    // narrow the rollup to a set that looks complete but isn't. A fresh
    // `get-branch-ci-status` cache entry keyed to that narrowed set would
    // then be indistinguishable from one computed against the true, full
    // set, letting a missing ruleset-required check hide behind a false
    // `passing`. Render `unknown` instead of proceeding.
    return 'unknown';
  }
  const mergedRequiredChecks = dedupeRequiredChecks([...requiredChecks, ...rulesetResult.checks]);

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
      commitSha,
      budget,
      mergedRequiredChecks,
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
  // Merge decoration is just as head-dependent as CI: a new head commit
  // before `synchronize` has been processed means the stored `mergeStatus`
  // still describes the previous head's mergeability, not the current one.
  // Require the same head-SHA match CI decoration uses rather than reusing
  // a recent-but-stale merge decision.
  const headMatchesCurrent = state?.headSha === pullRequest.headSha;
  const ciFresh = isFresh(state?.ciUpdatedAt, nowMs, staleAfterMs) && headMatchesCurrent;
  const mergeFresh = isFresh(state?.mergeUpdatedAt, nowMs, staleAfterMs) && headMatchesCurrent;
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
