/**
 * Dashboard read-model types.
 *
 * Pure type definitions and status-classification helpers for the
 * repository/pull-request overview dashboard. No runtime dependencies
 * beyond the shared CI/merge status enums, so these can be imported from
 * both server code and (eventually) the presentation layer without pulling
 * in database or Octokit clients.
 *
 * Two CI signals are deliberately kept separate and must never be
 * collapsed into one generic status:
 *
 * - `defaultBranchStatus` on {@link RepositoryDashboardRow} — the
 *   repository's default branch continuous integration rollup.
 * - `ciStatus` on {@link PullRequestDashboardRow} — the pull request's
 *   head commit continuous integration rollup.
 */
import type { CIStatus, MergeStatus } from '@tribunal/database/schema';

export type { CIStatus, MergeStatus };

/** Alias documenting that this CI status describes a branch, not a PR head. */
export type BranchCIStatus = CIStatus;

/** Repository identity fields the dashboard service needs from an already-authorized repository. */
export interface DashboardRepositoryIdentity {
  id: number;
  owner: string;
  name: string;
  /** Synced from GitHub installation repository data. `null` when unknown. */
  defaultBranch: string | null;
  /** Latest known default-branch commit SHA. `null` when unknown/never observed. */
  commit: string | null;
  /** GitHub App installation backing this repository. `null` when unresolved. */
  installationId: number | null;
  htmlUrl?: string;
}

/** Author summary used on dashboard pull request rows. */
export interface DashboardPullRequestAuthor {
  login: string;
  htmlUrl: string;
}

/**
 * One open pull request as it appears on the dashboard.
 *
 * `ciStatus`, `mergeStatus`, and `unresolvedThreadCount` are cached
 * decorations from `pull_request_state`, each with its own freshness
 * timestamp. A `null` timestamp or a timestamp older than the service's
 * staleness threshold means the corresponding status/count renders as
 * `unknown` (or `null` for counts) rather than a guessed value.
 */
export interface PullRequestDashboardRow {
  repositoryId: number;
  number: number;
  title: string;
  htmlUrl: string;
  author: DashboardPullRequestAuthor | null;
  draft: boolean;
  headRef: string;
  baseRef: string;
  headSha: string;
  ciStatus: CIStatus;
  ciUpdatedAt: string | null;
  mergeStatus: MergeStatus;
  mergeUpdatedAt: string | null;
  /** `null` when the decoration is missing or stale — never a guessed count. */
  unresolvedThreadCount: number | null;
  reviewUpdatedAt: string | null;
  updatedAt: string;
}

/** Why a repository row could not be fully populated from GitHub this build. */
export type DashboardUnavailableReason =
  | 'no-installation'
  | 'api-budget-exhausted'
  | 'rate-limited'
  | 'github-error';

/** One repository row on the dashboard. */
export interface RepositoryDashboardRow {
  repository: {
    id: number;
    owner: string;
    name: string;
    defaultBranch: string | null;
    htmlUrl?: string;
  };
  /** Default-branch CI status. `unknown` when `defaultBranch`/`commit` is missing or the read failed. */
  defaultBranchStatus: BranchCIStatus;
  /** `null` when GitHub inventory could not be read this build (budget exhausted, rate limited, error). */
  openPullRequestCount: number | null;
  /** True when the fetched list hit the 100-per-page cap — there may be more. */
  openPullRequestCountAtCap: boolean;
  /** `null` when inventory is unavailable; otherwise a count derived from `pullRequests`. */
  attentionPullRequestCount: number | null;
  /** Sum of known per-PR unresolved thread counts (nulls treated as 0 for this rollup). */
  unresolvedThreadCount: number;
  pullRequests: PullRequestDashboardRow[];
  refreshedAt: string;
  dataStatus: 'ok' | 'unavailable';
  unavailableReason?: DashboardUnavailableReason;
}

export interface DashboardOptions {
  /** Cap on live GitHub calls across the whole dashboard build. */
  apiBudget?: number;
  /** Cached decoration older than this is rendered as `unknown` rather than reused. Milliseconds. */
  staleAfterMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

// ============================================================================
// Status classification
// ============================================================================

/** CI statuses that should surface a pull request in the attention list. */
export function isAttentionCiStatus(status: CIStatus): boolean {
  switch (status) {
    case 'failing':
    case 'error':
      return true;
    case 'passing':
    case 'pending':
    case 'unknown':
      return false;
  }
}

/** Merge statuses that should surface a pull request in the attention list. */
export function isAttentionMergeStatus(status: MergeStatus): boolean {
  switch (status) {
    case 'conflicts':
      return true;
    case 'clean':
    case 'behind':
    case 'blocked':
    case 'unknown':
      return false;
  }
}

/**
 * A pull request needs attention when continuous integration is failing or
 * errored, it conflicts with its base branch, or it has unresolved review
 * threads. `unknown`/missing signals never count as attention — an absent
 * signal is not evidence of a problem.
 */
export function pullRequestNeedsAttention(
  pullRequest: Pick<PullRequestDashboardRow, 'ciStatus' | 'mergeStatus' | 'unresolvedThreadCount'>,
): boolean {
  return (
    isAttentionCiStatus(pullRequest.ciStatus) ||
    isAttentionMergeStatus(pullRequest.mergeStatus) ||
    (pullRequest.unresolvedThreadCount ?? 0) > 0
  );
}
