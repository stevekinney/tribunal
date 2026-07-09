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
      makeRow({
        repository: { id: 3, owner: 'acme', name: 'c', defaultBranch: 'main' },
        defaultBranchStatus: 'unknown',
      }),
    ]);

    expect(summary.failingDefaultBranchCount).toBe(1);
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
});
