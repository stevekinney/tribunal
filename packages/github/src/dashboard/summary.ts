/**
 * Dashboard summary aggregation.
 *
 * Rolls up per-repository dashboard rows into the counts shown in the
 * overview's summary strip. Honesty over precision (Task 18): once any
 * contributing repository is unavailable (rate limited, budget exhausted, no
 * installation, GitHub error) or hit the 100-per-page pull request cap, the
 * corresponding total is flagged inexact rather than silently presented as a
 * precise number.
 */
import type { RepositoryDashboardRow } from './types.js';

export interface DashboardSummary {
  /** Every accessible repository, regardless of watch state or data availability. */
  totalRepositoryCount: number;
  /** Repositories whose default branch continuous integration is `failing`. */
  failingDefaultBranchCount: number;
  /** `false` when any repository's default-branch CI status is `unknown` (unread, unresolved, or an unavailable row). */
  failingDefaultBranchCountExact: boolean;
  /** Sum of known open pull request counts. Unavailable repositories contribute 0. */
  openPullRequestCount: number;
  /** `false` when any repository is unavailable or hit the 100-item page cap. */
  openPullRequestCountExact: boolean;
  /** Sum of known attention pull request counts. Unavailable repositories contribute 0. */
  attentionPullRequestCount: number;
  /** `false` when any repository is unavailable or hit the 100-item page cap. */
  attentionPullRequestCountExact: boolean;
  /** True when at least one repository's GitHub data could not be read this build. */
  hasUnavailableRepositories: boolean;
}

/** Build the summary strip counts from already-built dashboard rows. */
export function buildDashboardSummary(rows: RepositoryDashboardRow[]): DashboardSummary {
  let failingDefaultBranchCount = 0;
  let failingDefaultBranchCountExact = true;
  let openPullRequestCount = 0;
  let openPullRequestCountExact = true;
  let attentionPullRequestCount = 0;
  let attentionPullRequestCountExact = true;
  let hasUnavailableRepositories = false;

  for (const row of rows) {
    if (row.defaultBranchStatus === 'failing') failingDefaultBranchCount += 1;
    // `unknown` means the branch's CI was never confirmed non-failing this
    // build (missing branch/commit, budget exhaustion, or a GitHub error) —
    // it is not evidence the branch is passing, so the rollup can't be exact.
    if (row.defaultBranchStatus === 'unknown') failingDefaultBranchCountExact = false;

    if (row.dataStatus === 'unavailable' || row.openPullRequestCount === null) {
      hasUnavailableRepositories = true;
      openPullRequestCountExact = false;
      attentionPullRequestCountExact = false;
      continue;
    }

    openPullRequestCount += row.openPullRequestCount;
    attentionPullRequestCount += row.attentionPullRequestCount ?? 0;
    if (row.openPullRequestCountAtCap) {
      openPullRequestCountExact = false;
      attentionPullRequestCountExact = false;
    }
  }

  return {
    totalRepositoryCount: rows.length,
    failingDefaultBranchCount,
    failingDefaultBranchCountExact,
    openPullRequestCount,
    openPullRequestCountExact,
    attentionPullRequestCount,
    attentionPullRequestCountExact,
    hasUnavailableRepositories,
  };
}
