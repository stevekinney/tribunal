import { describe, expect, it } from 'vitest';
import { buildDashboardSummary } from './summary.js';
import type { RepositoryDashboardRow } from './types.js';

function makeRow(overrides: Partial<RepositoryDashboardRow> = {}): RepositoryDashboardRow {
  return {
    repository: { id: 1, owner: 'acme', name: 'widgets', defaultBranch: 'main' },
    defaultBranchStatus: 'passing',
    openPullRequestCount: 3,
    openPullRequestCountAtCap: false,
    attentionPullRequestCount: 1,
    unresolvedThreadCount: 1,
    pullRequests: [],
    refreshedAt: '2026-07-09T00:00:00.000Z',
    dataStatus: 'ok',
    ...overrides,
  };
}

describe('buildDashboardSummary', () => {
  it('returns all-zero counts for an empty repository set', () => {
    expect(buildDashboardSummary([])).toEqual({
      totalRepositoryCount: 0,
      failingDefaultBranchCount: 0,
      failingDefaultBranchCountExact: true,
      openPullRequestCount: 0,
      openPullRequestCountExact: true,
      attentionPullRequestCount: 0,
      attentionPullRequestCountExact: true,
      hasUnavailableRepositories: false,
    });
  });

  it('sums exact counts across healthy repositories', () => {
    const summary = buildDashboardSummary([
      makeRow({ openPullRequestCount: 3, attentionPullRequestCount: 1 }),
      makeRow({
        repository: { id: 2, owner: 'acme', name: 'gadgets', defaultBranch: 'main' },
        openPullRequestCount: 5,
        attentionPullRequestCount: 0,
      }),
    ]);

    expect(summary.totalRepositoryCount).toBe(2);
    expect(summary.openPullRequestCount).toBe(8);
    expect(summary.openPullRequestCountExact).toBe(true);
    expect(summary.attentionPullRequestCount).toBe(1);
    expect(summary.attentionPullRequestCountExact).toBe(true);
    expect(summary.hasUnavailableRepositories).toBe(false);
  });

  it('counts only `failing` default branches, not `error` or `unknown`', () => {
    const summary = buildDashboardSummary([
      makeRow({ defaultBranchStatus: 'failing' }),
      makeRow({
        repository: { id: 2, owner: 'acme', name: 'b', defaultBranch: 'main' },
        defaultBranchStatus: 'error',
      }),
    ]);

    expect(summary.failingDefaultBranchCount).toBe(1);
  });

  it('marks the failing-branch rollup inexact when a row is `ok` but its branch CI is `unknown`', () => {
    // A repository row can be `dataStatus: 'ok'` (pull requests were read
    // fine) while its default-branch CI status is still `unknown` — missing
    // branch/commit, per-check budget exhaustion, or a GitHub error scoped
    // to just the branch-status read. `hasUnavailableRepositories` stays
    // false in that case, so the failing-branch count must track its own
    // exactness rather than piggybacking on row-level unavailability.
    const summary = buildDashboardSummary([
      makeRow({ defaultBranchStatus: 'passing' }),
      makeRow({
        repository: { id: 2, owner: 'acme', name: 'c', defaultBranch: 'main' },
        defaultBranchStatus: 'unknown',
        dataStatus: 'ok',
      }),
    ]);

    expect(summary.failingDefaultBranchCount).toBe(0);
    expect(summary.failingDefaultBranchCountExact).toBe(false);
    expect(summary.hasUnavailableRepositories).toBe(false);
  });

  it('marks totals inexact and flags unavailability when a repository could not be read', () => {
    const summary = buildDashboardSummary([
      makeRow({ openPullRequestCount: 3, attentionPullRequestCount: 1 }),
      makeRow({
        repository: { id: 2, owner: 'acme', name: 'gadgets', defaultBranch: null },
        dataStatus: 'unavailable',
        unavailableReason: 'rate-limited',
        openPullRequestCount: null,
        attentionPullRequestCount: null,
        unresolvedThreadCount: null,
        defaultBranchStatus: 'unknown',
      }),
    ]);

    // Unavailable repositories contribute 0, not a guessed value.
    expect(summary.openPullRequestCount).toBe(3);
    expect(summary.attentionPullRequestCount).toBe(1);
    expect(summary.openPullRequestCountExact).toBe(false);
    expect(summary.attentionPullRequestCountExact).toBe(false);
    expect(summary.hasUnavailableRepositories).toBe(true);
  });

  it('marks totals inexact when a repository hit the 100-item pull request page cap', () => {
    const summary = buildDashboardSummary([
      makeRow({
        openPullRequestCount: 100,
        openPullRequestCountAtCap: true,
        attentionPullRequestCount: 4,
      }),
    ]);

    expect(summary.openPullRequestCount).toBe(100);
    expect(summary.openPullRequestCountExact).toBe(false);
    expect(summary.attentionPullRequestCountExact).toBe(false);
    expect(summary.hasUnavailableRepositories).toBe(false);
  });

  it('marks the attention rollup inexact when a fetched pull request has unknown/missing signals', () => {
    // Repository inventory can succeed (`dataStatus: 'ok'`) while an
    // individual pull request's cached decoration is missing or stale, so
    // `decoratePullRequest` reports `ciStatus`/`mergeStatus: 'unknown'` and
    // `unresolvedThreadCount: null`. That PR was never actually inspected,
    // so a `0` attention total would be an absence of evidence, not
    // evidence of absence — even though the row is otherwise available and
    // under the page cap.
    const summary = buildDashboardSummary([
      makeRow({
        openPullRequestCount: 1,
        attentionPullRequestCount: 0,
        pullRequests: [
          {
            repositoryId: 1,
            number: 1,
            title: 'Uninspected PR',
            htmlUrl: 'https://github.com/acme/widgets/pull/1',
            author: null,
            draft: false,
            headRef: 'feature',
            baseRef: 'main',
            headSha: 'abc123',
            ciStatus: 'unknown',
            ciUpdatedAt: null,
            mergeStatus: 'unknown',
            mergeUpdatedAt: null,
            unresolvedThreadCount: null,
            reviewUpdatedAt: null,
            updatedAt: '2026-07-09T00:00:00.000Z',
          },
        ],
      }),
    ]);

    expect(summary.attentionPullRequestCount).toBe(0);
    expect(summary.attentionPullRequestCountExact).toBe(false);
    expect(summary.openPullRequestCountExact).toBe(true);
    expect(summary.hasUnavailableRepositories).toBe(false);
  });

  it('keeps the attention rollup exact when every fetched pull request has known signals', () => {
    const summary = buildDashboardSummary([
      makeRow({
        openPullRequestCount: 1,
        attentionPullRequestCount: 0,
        pullRequests: [
          {
            repositoryId: 1,
            number: 1,
            title: 'Inspected PR',
            htmlUrl: 'https://github.com/acme/widgets/pull/1',
            author: null,
            draft: false,
            headRef: 'feature',
            baseRef: 'main',
            headSha: 'abc123',
            ciStatus: 'passing',
            ciUpdatedAt: '2026-07-09T00:00:00.000Z',
            mergeStatus: 'clean',
            mergeUpdatedAt: '2026-07-09T00:00:00.000Z',
            unresolvedThreadCount: 0,
            reviewUpdatedAt: '2026-07-09T00:00:00.000Z',
            updatedAt: '2026-07-09T00:00:00.000Z',
          },
        ],
      }),
    ]);

    expect(summary.attentionPullRequestCountExact).toBe(true);
  });
});
