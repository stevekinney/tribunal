import { describe, it, expect, vi } from 'vitest';
import type { GithubServiceContext } from '../../context.js';
import { getDefaultBranchCiStatus, getFailingCheckCount, mapMergeableState } from './queries.js';

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
) {
  const listForRef = vi.fn();
  for (const page of pages) {
    listForRef.mockResolvedValueOnce({ data: page });
  }
  return { rest: { checks: { listForRef } } } as never;
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
    const octokit = { rest: { checks: { listForRef } } } as never;

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
    const octokit = { rest: { checks: { listForRef } } } as never;

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

  it('spends one budget unit per check-run page fetched, not one per call', async () => {
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
    expect(budget.spend).toHaveBeenCalledTimes(2);
    expect(budget.canSpend).toHaveBeenCalledTimes(2);
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
});
