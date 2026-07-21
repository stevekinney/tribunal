import { describe, it, expect, vi } from 'vitest';
import type { GithubServiceContext } from '../../context.js';
import {
  getAggregateReviewState,
  getDefaultBranchCiStatus,
  getFailingCheckCount,
  mapMergeableState,
} from './queries.js';

function createMockContext(overrides?: Partial<GithubServiceContext>): GithubServiceContext {
  return {
    db: {} as never,
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
    getGithubApplication: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

function createMockOctokit(
  pages: Array<{ total_count: number; check_runs: Array<Record<string, unknown>> }>,
  combinedStatus: { total_count: number; state: 'success' | 'failure' | 'error' | 'pending' } = {
    total_count: 0,
    state: 'pending',
  },
) {
  const listForRef = vi.fn();
  for (const page of pages) {
    listForRef.mockResolvedValueOnce({ data: page });
  }
  const getCombinedStatusForRef = vi.fn().mockResolvedValue({ data: combinedStatus });
  return {
    rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
  } as never;
}

describe('mapMergeableState', () => {
  it.each([
    ['clean', 'clean'],
    ['dirty', 'conflicts'],
    ['behind', 'behind'],
    ['blocked', 'blocked'],
    ['unknown', 'unknown'],
    [undefined, 'unknown'],
    ['garbage', 'unknown'],
  ] as const)('maps mergeable_state %s to %s', (input, expected) => {
    expect.assertions(1);
    expect(mapMergeableState(input)).toBe(expected);
  });
});

describe('getAggregateReviewState', () => {
  function createReviewOctokit(
    reviews: Array<Record<string, unknown>>,
    threadPages: Array<{
      nodes: Array<{ isResolved: boolean }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    }> = [{ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }],
  ) {
    const listReviews = vi.fn().mockResolvedValueOnce({ data: reviews });
    const graphql = vi.fn();
    for (const page of threadPages) {
      graphql.mockResolvedValueOnce({
        repository: { pullRequest: { reviewThreads: page } },
      });
    }
    return { rest: { pulls: { listReviews } }, graphql } as never;
  }

  it('computes approvalCount/changesRequestedCount and reviewStatus from the latest review per user', async () => {
    const octokit = createReviewOctokit([
      { user: { id: 1 }, state: 'CHANGES_REQUESTED' },
      // A later review from the same user supersedes the earlier one.
      { user: { id: 1 }, state: 'APPROVED' },
      { user: { id: 2 }, state: 'APPROVED' },
    ]);

    const result = await getAggregateReviewState(undefined, octokit, 'owner', 'repo', 42);

    expect(result).toEqual({
      reviewStatus: 'approved',
      approvalCount: 2,
      changesRequestedCount: 0,
      unresolvedThreadCount: 0,
    });
  });

  it('reports changes_requested when at least one reviewer requested changes', async () => {
    const octokit = createReviewOctokit([
      { user: { id: 1 }, state: 'APPROVED' },
      { user: { id: 2 }, state: 'CHANGES_REQUESTED' },
    ]);

    const result = await getAggregateReviewState(undefined, octokit, 'owner', 'repo', 42);

    expect(result.reviewStatus).toBe('changes_requested');
    expect(result.changesRequestedCount).toBe(1);
  });

  it('reports pending when there are no reviews', async () => {
    const octokit = createReviewOctokit([]);

    const result = await getAggregateReviewState(undefined, octokit, 'owner', 'repo', 42);

    expect(result.reviewStatus).toBe('pending');
  });

  it('ignores a review with no user or no state', async () => {
    const octokit = createReviewOctokit([{ user: null, state: 'APPROVED' }, { user: { id: 1 } }]);

    const result = await getAggregateReviewState(undefined, octokit, 'owner', 'repo', 42);

    expect(result.approvalCount).toBe(0);
  });

  it('paginates reviews across more than one page', async () => {
    // GitHub user ids are always positive; start at 1 rather than 0 so this
    // fixture reflects a real payload (an id of exactly 0 would be dropped
    // by the source's `!review.user?.id` falsy check, which is only ever
    // true in that unreachable-in-practice case).
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      user: { id: index + 1 },
      state: 'APPROVED',
    }));
    const listReviews = vi.fn();
    listReviews.mockResolvedValueOnce({ data: fullPage });
    listReviews.mockResolvedValueOnce({ data: [{ user: { id: 999 }, state: 'APPROVED' }] });
    const octokit = {
      rest: { pulls: { listReviews } },
      graphql: vi.fn().mockResolvedValueOnce({
        repository: {
          pullRequest: {
            reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          },
        },
      }),
    } as never;

    const result = await getAggregateReviewState(undefined, octokit, 'owner', 'repo', 42);

    expect(result.approvalCount).toBe(101);
    expect(listReviews).toHaveBeenCalledTimes(2);
  });

  it('sums unresolved thread counts across paginated GraphQL results', async () => {
    const octokit = createReviewOctokit(
      [],
      [
        {
          nodes: [{ isResolved: false }, { isResolved: true }],
          pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
        },
        {
          nodes: [{ isResolved: false }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      ],
    );

    const result = await getAggregateReviewState(undefined, octokit, 'owner', 'repo', 42);

    expect(result.unresolvedThreadCount).toBe(2);
  });

  it('logs and falls back to 0 unresolved threads when the GraphQL call fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const listReviews = vi.fn().mockResolvedValueOnce({ data: [] });
    const octokit = {
      rest: { pulls: { listReviews } },
      graphql: vi.fn().mockRejectedValueOnce(new Error('GraphQL down')),
    } as never;

    const result = await getAggregateReviewState(undefined, octokit, 'owner', 'repo', 42);

    expect(result.unresolvedThreadCount).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[github-cache] getAggregateReviewState GraphQL thread count failed:',
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it('caches results under the get-aggregate-review-state policy when a context is provided', async () => {
    const context = createMockContext();
    const octokit = createReviewOctokit([{ user: { id: 1 }, state: 'APPROVED' }]);

    await getAggregateReviewState(context, octokit, 'acme', 'widgets', 42);

    expect(context.cache.setCache).toHaveBeenCalledTimes(1);
    const [cacheKey] = (context.cache.setCache as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(cacheKey).toBe('github:response:acme:widgets:pr:42:review-state');
  });
});

describe('getFailingCheckCount', () => {
  it.each([
    ['passing', [{ status: 'completed', conclusion: 'success' }], 1],
    ['failing', [{ status: 'completed', conclusion: 'failure' }], 1],
    ['error', [{ status: 'completed', conclusion: 'cancelled' }], 1],
    ['pending', [{ status: 'in_progress', conclusion: null }], 1],
    ['unknown', [], 0],
  ] as const)('maps check runs to %s', async (expected, checkRuns, totalCount) => {
    expect.assertions(1);
    const octokit = createMockOctokit([{ total_count: totalCount, check_runs: [...checkRuns] }]);
    const result = await getFailingCheckCount(undefined, octokit, 'owner', 'repo', 'sha123');
    expect(result.ciStatus).toBe(expected);
  });

  it('caches results under the get-failing-check-count policy when a context is provided', async () => {
    expect.assertions(2);
    const context = createMockContext();
    const octokit = createMockOctokit([
      { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] },
    ]);

    const result = await getFailingCheckCount(context, octokit, 'acme', 'widgets', 'sha-abc');

    expect(result.ciStatus).toBe('passing');
    expect(context.cache.setCache).toHaveBeenCalledTimes(1);
  });

  it('prioritizes failing over error and pending', async () => {
    expect.assertions(1);
    const octokit = createMockOctokit([
      {
        total_count: 3,
        check_runs: [
          { status: 'completed', conclusion: 'failure' },
          { status: 'completed', conclusion: 'cancelled' },
          { status: 'in_progress', conclusion: null },
        ],
      },
    ]);
    const result = await getFailingCheckCount(undefined, octokit, 'owner', 'repo', 'sha123');
    expect(result.ciStatus).toBe('failing');
  });

  it('rolls up action_required as error rather than passing', async () => {
    expect.assertions(1);
    const octokit = createMockOctokit([
      { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'action_required' }] },
    ]);
    const result = await getFailingCheckCount(undefined, octokit, 'owner', 'repo', 'sha123');
    expect(result.ciStatus).toBe('error');
  });
});

describe('getDefaultBranchCiStatus', () => {
  it('reads check runs for the resolved commit SHA, not the branch name', async () => {
    expect.assertions(2);
    const listForRef = vi.fn().mockResolvedValue({
      data: { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] },
    });
    const getCombinedStatusForRef = vi
      .fn()
      .mockResolvedValue({ data: { total_count: 0, state: 'pending' } });
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;

    const result = await getDefaultBranchCiStatus(
      undefined,
      octokit,
      'owner',
      'repo',
      'main',
      'commitsha1',
    );

    expect(result.ciStatus).toBe('passing');
    expect(listForRef).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'owner', repo: 'repo', ref: 'commitsha1' }),
    );
  });

  it('caches under the get-branch-ci-status policy keyed by (owner, repo, branch)', async () => {
    expect.assertions(2);
    const context = createMockContext();
    const octokit = createMockOctokit([
      { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] },
    ]);

    await getDefaultBranchCiStatus(context, octokit, 'acme', 'widgets', 'main', 'sha-abc');

    expect(context.cache.setCache).toHaveBeenCalledTimes(1);
    const [cacheKey] = (context.cache.setCache as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(cacheKey).toBe('github:response:acme:widgets:branch:main:ci-status');
  });

  it('maps no check runs to unknown', async () => {
    expect.assertions(1);
    const octokit = createMockOctokit([{ total_count: 0, check_runs: [] }]);
    const result = await getDefaultBranchCiStatus(
      undefined,
      octokit,
      'owner',
      'repo',
      'main',
      'sha',
    );
    expect(result.ciStatus).toBe('unknown');
  });

  it('bypasses a cache hit computed for a different commit than requested', async () => {
    expect.assertions(2);
    const context = createMockContext({
      cache: {
        getCached: vi.fn().mockResolvedValue({
          value: { ciStatus: 'passing', checkCount: 1, failingCount: 0, commitSha: 'old-sha' },
          etag: undefined,
          fetchedAt: Date.now(),
          expiresAt: Date.now() + 30_000,
        }),
        setCache: vi.fn().mockResolvedValue(true),
        setCacheIndefinitely: vi.fn().mockResolvedValue(true),
        deleteCache: vi.fn().mockResolvedValue(true),
        deleteCacheByPattern: vi.fn().mockResolvedValue(0),
        resetCacheClient: vi.fn(),
      },
    });
    const listForRef = vi.fn().mockResolvedValue({
      data: { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'failure' }] },
    });
    const getCombinedStatusForRef = vi
      .fn()
      .mockResolvedValue({ data: { total_count: 0, state: 'pending' } });
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;

    // The default branch advanced to 'new-sha' since the cached entry (for
    // 'old-sha') was stored — the stale commit's rollup must not be reused.
    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'owner',
      'repo',
      'main',
      'new-sha',
    );

    expect(result.ciStatus).toBe('failing');
    expect(listForRef).toHaveBeenCalledWith(expect.objectContaining({ ref: 'new-sha' }));
  });

  it('bypasses a cache hit computed for a different required-check set', async () => {
    expect.assertions(1);
    const context = createMockContext({
      cache: {
        getCached: vi.fn().mockResolvedValue({
          value: {
            ciStatus: 'passing',
            checkCount: 1,
            failingCount: 0,
            commitSha: 'sha-1',
            requiredKey: 'Old Check',
          },
          etag: undefined,
          fetchedAt: Date.now(),
          expiresAt: Date.now() + 30_000,
        }),
        setCache: vi.fn().mockResolvedValue(true),
        setCacheIndefinitely: vi.fn().mockResolvedValue(true),
        deleteCache: vi.fn().mockResolvedValue(true),
        deleteCacheByPattern: vi.fn().mockResolvedValue(0),
        resetCacheClient: vi.fn(),
      },
    });
    const listForRef = vi.fn().mockResolvedValue({
      data: {
        total_count: 1,
        check_runs: [{ name: 'New Check', status: 'completed', conclusion: 'failure' }],
      },
    });
    const getCombinedStatusForRef = vi
      .fn()
      .mockResolvedValue({ data: { total_count: 0, state: 'pending' } });
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;

    // Same commit as the cached entry, but the branch's required-check set
    // changed — the stale verdict must not be replayed for the new set.
    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'owner',
      'repo',
      'main',
      'sha-1',
      undefined,
      [{ context: 'New Check', appId: null }],
    );

    expect(result.ciStatus).toBe('failing');
  });

  it('deletes the cache entry when the commit-mismatch refetch is itself budget-truncated', async () => {
    expect.assertions(1);
    const context = createMockContext({
      cache: {
        getCached: vi.fn().mockResolvedValue({
          value: { ciStatus: 'passing', checkCount: 1, failingCount: 0, commitSha: 'old-sha' },
          etag: undefined,
          fetchedAt: Date.now(),
          expiresAt: Date.now() + 30_000,
        }),
        setCache: vi.fn().mockResolvedValue(true),
        setCacheIndefinitely: vi.fn().mockResolvedValue(true),
        deleteCache: vi.fn().mockResolvedValue(true),
        deleteCacheByPattern: vi.fn().mockResolvedValue(0),
        resetCacheClient: vi.fn(),
      },
    });
    const octokit = createMockOctokit([
      { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] },
    ]);
    // A budget that's already exhausted before the refetch starts -- the
    // refetch for the new commit is immediately truncated.
    const budget = { canSpend: vi.fn().mockReturnValue(false), spend: vi.fn() };

    await getDefaultBranchCiStatus(context, octokit, 'owner', 'repo', 'main', 'new-sha', budget);

    expect(context.cache.deleteCache).toHaveBeenCalledWith(
      'github:response:owner:repo:branch:main:ci-status',
    );
  });

  it('spends one budget unit per check-run page fetched, plus one for the combined status read', async () => {
    expect.assertions(3);
    const page1 = Array.from({ length: 100 }, () => ({
      status: 'completed',
      conclusion: 'success',
    }));
    const page2 = [{ status: 'completed', conclusion: 'success' }];
    const octokit = createMockOctokit([
      { total_count: 101, check_runs: page1 },
      { total_count: 101, check_runs: page2 },
    ]);
    const budget = { canSpend: vi.fn().mockReturnValue(true), spend: vi.fn() };

    const result = await getDefaultBranchCiStatus(
      undefined,
      octokit,
      'owner',
      'repo',
      'main',
      'sha',
      budget,
    );

    expect(result.ciStatus).toBe('passing');
    // 2 check-run pages + 1 combined-status read.
    expect(budget.spend).toHaveBeenCalledTimes(3);
    expect(budget.canSpend).toHaveBeenCalledTimes(3);
  });

  it('reports unknown instead of a guessed passing status when the budget runs out mid-pagination', async () => {
    expect.assertions(2);
    const page1 = Array.from({ length: 100 }, () => ({
      status: 'completed',
      conclusion: 'success',
    }));
    const octokit = createMockOctokit([{ total_count: 150, check_runs: page1 }]);
    let calls = 0;
    const budget = {
      canSpend: vi.fn().mockImplementation(() => {
        calls += 1;
        return calls <= 1;
      }),
      spend: vi.fn(),
    };

    const result = await getDefaultBranchCiStatus(
      undefined,
      octokit,
      'owner',
      'repo',
      'main',
      'sha',
      budget,
    );

    expect(result.ciStatus).toBe('unknown');
    expect(budget.spend).toHaveBeenCalledTimes(1);
  });

  it('does not report pending when there are zero commit-status contexts', async () => {
    // getCombinedStatusForRef reports an aggregate state of "pending" even
    // when total_count is 0 (no legacy commit statuses at all) — a
    // check-run-only repository must not be dragged down to "pending" by
    // that empty-set artifact.
    expect.assertions(1);
    const octokit = createMockOctokit(
      [{ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] }],
      { total_count: 0, state: 'pending' },
    );

    const result = await getDefaultBranchCiStatus(
      undefined,
      octokit,
      'owner',
      'repo',
      'main',
      'sha',
    );

    expect(result.ciStatus).toBe('passing');
  });

  it('reports failing when a commit-status context is failing even if all check runs pass', async () => {
    expect.assertions(1);
    const octokit = createMockOctokit(
      [{ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] }],
      { total_count: 1, state: 'failure' },
    );

    const result = await getDefaultBranchCiStatus(
      undefined,
      octokit,
      'owner',
      'repo',
      'main',
      'sha',
    );

    expect(result.ciStatus).toBe('failing');
  });

  it('reports passing from commit-status contexts alone when there are no check runs', async () => {
    expect.assertions(1);
    const octokit = createMockOctokit([{ total_count: 0, check_runs: [] }], {
      total_count: 2,
      state: 'success',
    });

    const result = await getDefaultBranchCiStatus(
      undefined,
      octokit,
      'owner',
      'repo',
      'main',
      'sha',
    );

    expect(result.ciStatus).toBe('passing');
  });

  it('reports error from an unfiltered commit-status context', async () => {
    expect.assertions(1);
    const octokit = createMockOctokit(
      [{ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] }],
      { total_count: 1, state: 'error' },
    );

    const result = await getDefaultBranchCiStatus(
      undefined,
      octokit,
      'owner',
      'repo',
      'main',
      'sha',
    );

    expect(result.ciStatus).toBe('error');
  });

  it('reports pending from an unfiltered commit-status context', async () => {
    expect.assertions(1);
    const octokit = createMockOctokit(
      [{ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] }],
      { total_count: 1, state: 'pending' },
    );

    const result = await getDefaultBranchCiStatus(
      undefined,
      octokit,
      'owner',
      'repo',
      'main',
      'sha',
    );

    expect(result.ciStatus).toBe('pending');
  });

  it('reports unknown (truncated) when the budget runs out on the unfiltered combined-status read itself', async () => {
    expect.assertions(2);
    const octokit = createMockOctokit([
      { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] },
    ]);
    let calls = 0;
    const budget = {
      // Allow the single check-run page, then deny the combined-status read.
      canSpend: vi.fn().mockImplementation(() => {
        calls += 1;
        return calls <= 1;
      }),
      spend: vi.fn(),
    };

    const result = await getDefaultBranchCiStatus(
      undefined,
      octokit,
      'owner',
      'repo',
      'main',
      'sha',
      budget,
    );

    expect(result.ciStatus).toBe('unknown');
    expect(budget.spend).toHaveBeenCalledTimes(1);
  });

  it('does not read commit-status contexts for the PR-head CI path', async () => {
    expect.assertions(1);
    const octokit = createMockOctokit([
      { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] },
    ]);

    await getFailingCheckCount(undefined, octokit, 'owner', 'repo', 'sha123');

    const { getCombinedStatusForRef } = (
      octokit as unknown as {
        rest: { repos: { getCombinedStatusForRef: ReturnType<typeof vi.fn> } };
      }
    ).rest.repos;
    expect(getCombinedStatusForRef).not.toHaveBeenCalled();
  });

  it('deletes the cached branch-CI envelope when a freshly-fetched rollup is truncated', async () => {
    expect.assertions(1);
    const context = createMockContext();
    const page1 = Array.from({ length: 100 }, () => ({
      status: 'completed',
      conclusion: 'success',
    }));
    const octokit = createMockOctokit([{ total_count: 150, check_runs: page1 }]);
    let calls = 0;
    const budget = {
      canSpend: vi.fn().mockImplementation(() => {
        calls += 1;
        return calls <= 1;
      }),
      spend: vi.fn(),
    };

    await getDefaultBranchCiStatus(context, octokit, 'acme', 'widgets', 'main', 'sha', budget);

    expect(context.cache.deleteCache).toHaveBeenCalledWith(
      'github:response:acme:widgets:branch:main:ci-status',
    );
  });

  it('does not delete the cache when a fresh (non-truncated) hit is served', async () => {
    expect.assertions(1);
    const context = createMockContext();
    const octokit = createMockOctokit([
      { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] },
    ]);

    await getDefaultBranchCiStatus(context, octokit, 'acme', 'widgets', 'main', 'sha-abc');

    expect(context.cache.deleteCache).not.toHaveBeenCalled();
  });
});

describe('getDefaultBranchCiStatus with required checks', () => {
  const requiredCheckRuns = [
    { name: 'Unit Tests', status: 'completed', conclusion: 'success' },
    { name: 'Deploy Production', status: 'completed', conclusion: 'failure' },
  ];

  it('ignores a failed non-required check so a deploy failure does not fail CI', async () => {
    const context = createMockContext();
    const octokit = createMockOctokit([{ total_count: 2, check_runs: requiredCheckRuns }]);

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      undefined,
      [{ context: 'Unit Tests', appId: null }],
    );

    expect(result.ciStatus).toBe('passing');
  });

  it('still fails when a required check fails', async () => {
    const context = createMockContext();
    const octokit = createMockOctokit([
      {
        total_count: 2,
        check_runs: [
          { name: 'Unit Tests', status: 'completed', conclusion: 'failure' },
          { name: 'Deploy Production', status: 'completed', conclusion: 'success' },
        ],
      },
    ]);

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      undefined,
      [{ context: 'Unit Tests', appId: null }],
    );

    expect(result.ciStatus).toBe('failing');
  });

  it('counts every check when no required checks are configured', async () => {
    const context = createMockContext();
    const octokit = createMockOctokit([{ total_count: 2, check_runs: requiredCheckRuns }]);

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      undefined,
      [],
    );

    // Empty required set preserves the prior behavior: the failed deploy fails CI.
    expect(result.ciStatus).toBe('failing');
  });

  it('is pending when a required check has not reported yet', async () => {
    const context = createMockContext();
    const octokit = createMockOctokit([
      {
        total_count: 1,
        check_runs: [{ name: 'Unit Tests', status: 'completed', conclusion: 'success' }],
      },
    ]);

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      undefined,
      [
        { context: 'Unit Tests', appId: null },
        { context: 'Lint', appId: null },
      ],
    );

    // 'Lint' is required but absent from the commit's checks — GitHub treats a
    // missing required check as still pending, not passing.
    expect(result.ciStatus).toBe('pending');
  });

  it('stops paging (and skips the status call) once all required checks are seen', async () => {
    const context = createMockContext();
    // A full first page (100 runs) with a higher total_count would normally
    // force a second page; the required check is present, so paging must stop.
    const page1 = [
      { name: 'Unit Tests', status: 'completed', conclusion: 'success' },
      ...Array.from({ length: 99 }, () => ({
        name: 'Deploy Production',
        status: 'completed',
        conclusion: 'failure',
      })),
    ];
    const listForRef = vi.fn().mockResolvedValue({ data: { total_count: 200, check_runs: page1 } });
    const getCombinedStatusForRef = vi
      .fn()
      .mockResolvedValue({ data: { total_count: 0, state: 'pending' } });
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      undefined,
      [{ context: 'Unit Tests', appId: null }],
    );

    expect(result.ciStatus).toBe('passing');
    expect(listForRef).toHaveBeenCalledTimes(1);
    expect(getCombinedStatusForRef).not.toHaveBeenCalled();
  });

  it('does not accept a same-named check run reported by a different app than the one required', async () => {
    const context = createMockContext();
    const octokit = createMockOctokit([
      {
        total_count: 1,
        check_runs: [
          { name: 'Unit Tests', status: 'completed', conclusion: 'success', app: { id: 999 } },
        ],
      },
    ]);

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      undefined,
      [{ context: 'Unit Tests', appId: 42 }],
    );

    // The required check pins app id 42; a same-named run from app 999 does
    // not satisfy it, so the required check is still "missing" — pending,
    // not a false green from a same-named impostor.
    expect(result.ciStatus).toBe('pending');
  });

  it('skips the combined-status read entirely when every outstanding required check is app-pinned', async () => {
    const context = createMockContext();
    const listForRef = vi.fn().mockResolvedValue({
      data: {
        total_count: 1,
        check_runs: [{ name: 'Deploy', status: 'completed', conclusion: 'success' }],
      },
    });
    const getCombinedStatusForRef = vi.fn();
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      undefined,
      [{ context: 'Unit Tests', appId: 42 }],
    );

    // A status context can never satisfy an app-pinned required check, so
    // this request would spend budget for nothing — never issue it.
    expect(getCombinedStatusForRef).not.toHaveBeenCalled();
    expect(result.ciStatus).toBe('pending');
  });

  it('accepts a check run from the specific app id an app-pinned required check names', async () => {
    const context = createMockContext();
    const octokit = createMockOctokit([
      {
        total_count: 1,
        check_runs: [
          { name: 'Unit Tests', status: 'completed', conclusion: 'success', app: { id: 42 } },
        ],
      },
    ]);

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      undefined,
      [{ context: 'Unit Tests', appId: 42 }],
    );

    expect(result.ciStatus).toBe('passing');
  });

  it('does not let a same-named legacy status context satisfy an app-pinned required check', async () => {
    const context = createMockContext();
    const listForRef = vi.fn().mockResolvedValue({ data: { total_count: 0, check_runs: [] } });
    const getCombinedStatusForRef = vi.fn().mockResolvedValue({
      data: { total_count: 1, statuses: [{ context: 'Unit Tests', state: 'success' }] },
    });
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      undefined,
      [{ context: 'Unit Tests', appId: 42 }],
    );

    // A legacy status context has no per-status app identity, so it can
    // never satisfy an app-pinned required check — the required check
    // stays "missing" (pending), not a false green from an impostor status.
    expect(result.ciStatus).toBe('pending');
  });

  it('finds a required legacy status context beyond the first page of combined statuses', async () => {
    const context = createMockContext();
    const listForRef = vi.fn().mockResolvedValue({ data: { total_count: 0, check_runs: [] } });
    const statusPage1 = Array.from({ length: 100 }, (_, index) => ({
      context: `context-${index}`,
      state: 'success',
    }));
    const statusPage2 = [{ context: 'Required Legacy Status', state: 'failure' }];
    const getCombinedStatusForRef = vi
      .fn()
      .mockResolvedValueOnce({ data: { total_count: 101, statuses: statusPage1 } })
      .mockResolvedValueOnce({ data: { total_count: 101, statuses: statusPage2 } });
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      undefined,
      [{ context: 'Required Legacy Status', appId: null }],
    );

    // Only found on page 2 of the combined-status pagination — without
    // reading past page 1, this would incorrectly report the required
    // check as never-reported (pending) rather than failing.
    expect(result.ciStatus).toBe('failing');
    expect(getCombinedStatusForRef).toHaveBeenCalledTimes(2);
  });

  it('rolls up error and pending legacy status states across two required-check status pages', async () => {
    const context = createMockContext();
    const listForRef = vi.fn().mockResolvedValue({ data: { total_count: 0, check_runs: [] } });
    const statusPage1 = [
      ...Array.from({ length: 99 }, (_, index) => ({
        context: `context-${index}`,
        state: 'success',
      })),
      { context: 'Required Error Status', state: 'error' },
    ];
    const statusPage2 = [{ context: 'Required Pending Status', state: 'pending' }];
    const getCombinedStatusForRef = vi
      .fn()
      .mockResolvedValueOnce({ data: { total_count: 101, statuses: statusPage1 } })
      .mockResolvedValueOnce({ data: { total_count: 101, statuses: statusPage2 } });
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;
    const budget = { canSpend: vi.fn().mockReturnValue(true), spend: vi.fn() };

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      budget,
      [
        { context: 'Required Error Status', appId: null },
        { context: 'Required Pending Status', appId: null },
      ],
    );

    expect(result.ciStatus).toBe('error');
    expect(getCombinedStatusForRef).toHaveBeenCalledTimes(2);
    // 1 check-run page + 2 status pages.
    expect(budget.spend).toHaveBeenCalledTimes(3);
  });

  it('never calls getCombinedStatusForRef (reports unknown) when the budget is exhausted before the status read starts', async () => {
    const context = createMockContext();
    const listForRef = vi.fn().mockResolvedValue({ data: { total_count: 0, check_runs: [] } });
    const getCombinedStatusForRef = vi.fn();
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;
    // Exactly enough budget for the (empty) check-run page and nothing left
    // for the combined-status read.
    let remaining = 1;
    const budget = {
      canSpend: vi.fn().mockImplementation((cost = 1) => remaining >= cost),
      spend: vi.fn().mockImplementation((cost = 1) => {
        remaining -= cost;
      }),
    };

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      budget,
      [{ context: 'Required Legacy Status', appId: null }],
    );

    expect(result.ciStatus).toBe('unknown');
    expect(getCombinedStatusForRef).not.toHaveBeenCalled();
  });

  it('stops reading combined-status pages (reports unknown) when the budget runs out mid-pagination', async () => {
    const context = createMockContext();
    const listForRef = vi.fn().mockResolvedValue({ data: { total_count: 0, check_runs: [] } });
    const statusPage1 = Array.from({ length: 100 }, (_, index) => ({
      context: `context-${index}`,
      state: 'success',
    }));
    const getCombinedStatusForRef = vi
      .fn()
      .mockResolvedValue({ data: { total_count: 101, statuses: statusPage1 } });
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;
    // Enough budget for the (empty) check-run page and the first status
    // page, but not a second status page.
    let remaining = 2;
    const budget = {
      canSpend: vi.fn().mockImplementation((cost = 1) => remaining >= cost),
      spend: vi.fn().mockImplementation((cost = 1) => {
        remaining -= cost;
      }),
    };

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      budget,
      [{ context: 'Required Legacy Status', appId: null }],
    );

    expect(result.ciStatus).toBe('unknown');
    expect(getCombinedStatusForRef).toHaveBeenCalledTimes(1);
  });

  it('reads a required check run on page 2 instead of spending the last budget unit on an early combined-status read', async () => {
    const context = createMockContext();
    // Page 1 is full of non-required runs and doesn't resolve the required
    // check; it's actually a plain check run that only shows up on page 2.
    const page1 = Array.from({ length: 100 }, () => ({
      name: 'Deploy Production',
      status: 'completed',
      conclusion: 'success',
    }));
    const page2 = [{ name: 'Unit Tests', status: 'completed', conclusion: 'success' }];
    const listForRef = vi
      .fn()
      .mockResolvedValueOnce({ data: { total_count: 101, check_runs: page1 } })
      .mockResolvedValueOnce({ data: { total_count: 101, check_runs: page2 } });
    const getCombinedStatusForRef = vi
      .fn()
      .mockResolvedValue({ data: { total_count: 0, statuses: [] } });
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;

    // Exactly enough budget to fetch page 1 and then page 2 — one unit left
    // after page 1, none to spare for an early combined-status read that
    // couldn't have resolved the check run anyway.
    let remaining = 2;
    const budget = {
      canSpend: vi.fn().mockImplementation((cost = 1) => remaining >= cost),
      spend: vi.fn().mockImplementation((cost = 1) => {
        remaining -= cost;
      }),
    };

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      budget,
      [{ context: 'Unit Tests', appId: null }],
    );

    // With only one budget unit left after page 1, spending it on a
    // combined-status read that can't resolve a plain check run would
    // exhaust the budget before page 2 (where the required check actually
    // lives) is ever fetched — truncating the rollup to `unknown` instead of
    // reading the required check run on page 2.
    expect(result.ciStatus).toBe('passing');
    expect(result.truncated).toBe(false);
    expect(listForRef).toHaveBeenCalledTimes(2);
  });

  it('never spends check-run-page budget on the combined status, even when combined status has multiple pages', async () => {
    const context = createMockContext();
    // Page 1 doesn't resolve the required check; it's a plain check run on
    // page 2. The combined status, if it were ever read, would itself span
    // two pages — capable of consuming far more than the single unit a
    // reserve-based scheme would have set aside for it.
    const page1 = Array.from({ length: 100 }, () => ({
      name: 'Deploy Production',
      status: 'completed',
      conclusion: 'success',
    }));
    const page2 = [{ name: 'Unit Tests', status: 'completed', conclusion: 'success' }];
    const listForRef = vi
      .fn()
      .mockResolvedValueOnce({ data: { total_count: 101, check_runs: page1 } })
      .mockResolvedValueOnce({ data: { total_count: 101, check_runs: page2 } });
    const statusPage1 = Array.from({ length: 100 }, (_, index) => ({
      context: `context-${index}`,
      state: 'success',
    }));
    const statusPage2 = [{ context: 'Unit Tests', state: 'success' }];
    const getCombinedStatusForRef = vi
      .fn()
      .mockResolvedValueOnce({ data: { total_count: 101, statuses: statusPage1 } })
      .mockResolvedValueOnce({ data: { total_count: 101, statuses: statusPage2 } });
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;

    // Exactly enough budget for page 1 and page 2 of check runs — none left
    // for even a single combined-status page, let alone two.
    let remaining = 2;
    const budget = {
      canSpend: vi.fn().mockImplementation((cost = 1) => remaining >= cost),
      spend: vi.fn().mockImplementation((cost = 1) => {
        remaining -= cost;
      }),
    };

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      budget,
      [{ context: 'Unit Tests', appId: null }],
    );

    // The required check run is found directly on check-run page 2 — the
    // combined status (which could have consumed two more units than any
    // reserve set aside for it) is never read at all.
    expect(result.ciStatus).toBe('passing');
    expect(result.truncated).toBe(false);
    expect(getCombinedStatusForRef).not.toHaveBeenCalled();
  });

  it('reads every check-run page before consulting the combined status for a required legacy status check', async () => {
    const context = createMockContext();
    // Two full check-run pages exist, but the required check never appears
    // among check runs at all — it's a legacy status context.
    const page1 = Array.from({ length: 100 }, () => ({
      name: 'Deploy Production',
      status: 'completed',
      conclusion: 'success',
    }));
    const page2 = Array.from({ length: 50 }, () => ({
      name: 'Deploy Production',
      status: 'completed',
      conclusion: 'success',
    }));
    const listForRef = vi
      .fn()
      .mockResolvedValueOnce({ data: { total_count: 150, check_runs: page1 } })
      .mockResolvedValueOnce({ data: { total_count: 150, check_runs: page2 } });
    const getCombinedStatusForRef = vi.fn().mockResolvedValue({
      data: { total_count: 1, statuses: [{ context: 'Legacy Status Check', state: 'success' }] },
    });
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      undefined,
      [{ context: 'Legacy Status Check', appId: null }],
    );

    expect(result.ciStatus).toBe('passing');
    // Both check-run pages are read (this required check never appears
    // among them) before the combined status is consulted — reading check
    // runs to completion first guarantees a same-named check run is always
    // seen and always wins over a legacy status result (see the regression
    // test below); the combined status only resolves whatever is left over.
    expect(listForRef).toHaveBeenCalledTimes(2);
  });

  it('does not let a required check pass via a legacy status when the same-named check run (on a later page) is failing', async () => {
    const context = createMockContext();
    // 'Deploy Gate' is reported both as a legacy status (passing) and — only
    // on check-run page 2 — as a check run (failing). The failure must win.
    const page1 = Array.from({ length: 100 }, () => ({
      name: 'Unrelated',
      status: 'completed',
      conclusion: 'success',
    }));
    const page2 = [{ name: 'Deploy Gate', status: 'completed', conclusion: 'failure' }];
    const listForRef = vi
      .fn()
      .mockResolvedValueOnce({ data: { total_count: 101, check_runs: page1 } })
      .mockResolvedValueOnce({ data: { total_count: 101, check_runs: page2 } });
    const getCombinedStatusForRef = vi.fn().mockResolvedValue({
      data: { total_count: 1, statuses: [{ context: 'Deploy Gate', state: 'success' }] },
    });
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      undefined,
      [{ context: 'Deploy Gate', appId: null }],
    );

    // A status-early-resolve-and-stop would have reported this as `passing`
    // (from the status) without ever reading the failing check run on page 2.
    expect(result.ciStatus).toBe('failing');
    expect(listForRef).toHaveBeenCalledTimes(2);
  });

  it('only counts the first entry for a required legacy status context, not every duplicate', async () => {
    const context = createMockContext();
    const listForRef = vi.fn().mockResolvedValue({ data: { total_count: 0, check_runs: [] } });
    // Defensive against a hypothetical duplicate — GitHub's combined-status
    // endpoint already dedupes to the latest state per context, but an older
    // failing duplicate must not override an earlier-seen passing entry.
    const getCombinedStatusForRef = vi.fn().mockResolvedValue({
      data: {
        total_count: 2,
        statuses: [
          { context: 'Required Status', state: 'success' },
          { context: 'Required Status', state: 'failure' },
        ],
      },
    });
    const octokit = {
      rest: { checks: { listForRef }, repos: { getCombinedStatusForRef } },
    } as never;

    const result = await getDefaultBranchCiStatus(
      context,
      octokit,
      'acme',
      'widgets',
      'main',
      'sha-abc',
      undefined,
      [{ context: 'Required Status', appId: null }],
    );

    expect(result.ciStatus).toBe('passing');
  });
});
