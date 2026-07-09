import { describe, it, expect, vi } from 'vitest';
import type { GithubServiceContext } from '../context.js';
import type { PullRequestState } from '@tribunal/database/schema';
import { buildRepositoryDashboard, DEFAULT_STALE_AFTER_MS } from './service.js';
import type { DashboardRepositoryIdentity } from './types.js';

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

function makeRepository(
  overrides: Partial<DashboardRepositoryIdentity> = {},
): DashboardRepositoryIdentity {
  return {
    id: 1,
    owner: 'acme',
    name: 'widgets',
    defaultBranch: 'main',
    commit: 'commit-sha-1',
    installationId: 100,
    ...overrides,
  };
}

function makePullRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    number: 1,
    title: 'Add feature',
    state: 'open',
    draft: false,
    locked: false,
    user: { login: 'author', avatar_url: null, html_url: 'https://github.com/author' },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    closed_at: null,
    merged_at: null,
    labels: [],
    head: { ref: 'feature', sha: 'headsha1' },
    base: { ref: 'main' },
    html_url: 'https://github.com/acme/widgets/pull/1',
    ...overrides,
  };
}

function makeOctokit(options: {
  pullRequests?: Array<Record<string, unknown>>;
  listPullsError?: unknown;
  checkRuns?: { total_count: number; check_runs: Array<Record<string, unknown>> };
  checksError?: unknown;
}) {
  const list = options.listPullsError
    ? vi.fn().mockRejectedValue(options.listPullsError)
    : vi.fn().mockResolvedValue({ data: options.pullRequests ?? [] });

  const listForRef = options.checksError
    ? vi.fn().mockRejectedValue(options.checksError)
    : vi.fn().mockResolvedValue({ data: options.checkRuns ?? { total_count: 0, check_runs: [] } });

  // Gated on total_count > 0 in paginateCheckRunsRollup, so this default
  // (empty) combined-status response never changes existing expectations.
  const getCombinedStatusForRef = vi
    .fn()
    .mockResolvedValue({ data: { total_count: 0, state: 'pending' } });

  return {
    rest: {
      pulls: { list },
      checks: { listForRef },
      repos: { getCombinedStatusForRef },
    },
  } as never;
}

function makePullRequestState(overrides: Partial<PullRequestState> = {}): PullRequestState {
  const now = new Date();
  return {
    id: 1,
    repositoryId: 1,
    prNumber: 1,
    state: 'open',
    isDraft: false,
    isMerged: false,
    headSha: 'headsha1',
    baseSha: 'basesha1',
    baseRef: 'main',
    ciStatus: 'passing',
    failingCheckCount: 0,
    ciUpdatedAt: now,
    reviewStatus: 'approved',
    approvalCount: 1,
    changesRequestedCount: 0,
    unresolvedThreadCount: 0,
    reviewUpdatedAt: now,
    mergeStatus: 'clean',
    mergeUpdatedAt: now,
    automationStatus: 'idle',
    attemptCount: 0,
    lastErrorMessage: null,
    lastTriggerSignature: null,
    signatureAttemptCount: 0,
    lastAttemptAt: null,
    isPaused: false,
    prUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function withDbSelectResult(rows: PullRequestState[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    }),
  } as never;
}

const rateLimitError = Object.assign(new Error('API rate limit exceeded'), {
  status: 403,
  response: { headers: { 'x-ratelimit-remaining': '0' } },
});

describe('buildRepositoryDashboard', () => {
  it('returns inventory and default-branch CI for a healthy repository', async () => {
    expect.assertions(4);
    const octokit = makeOctokit({
      pullRequests: [makePullRequest()],
      checkRuns: { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] },
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([makePullRequestState()]),
    });

    const rows = await buildRepositoryDashboard(context, [makeRepository()]);

    expect(rows).toHaveLength(1);
    expect(rows[0].dataStatus).toBe('ok');
    expect(rows[0].defaultBranchStatus).toBe('passing');
    expect(rows[0].openPullRequestCount).toBe(1);
  });

  it('derives attention count from failing CI, conflicts, or unresolved threads', async () => {
    expect.assertions(1);
    const octokit = makeOctokit({
      pullRequests: [makePullRequest({ number: 1 }), makePullRequest({ number: 2 })],
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([
        makePullRequestState({ prNumber: 1, ciStatus: 'failing' }),
        makePullRequestState({ prNumber: 2, mergeStatus: 'clean', ciStatus: 'passing' }),
      ]),
    });

    const rows = await buildRepositoryDashboard(context, [makeRepository()]);

    expect(rows[0].attentionPullRequestCount).toBe(1);
  });

  it('renders unknown default-branch status when defaultBranch is missing', async () => {
    expect.assertions(1);
    const octokit = makeOctokit({ pullRequests: [] });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
    });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ defaultBranch: null, commit: null }),
    ]);

    expect(rows[0].defaultBranchStatus).toBe('unknown');
  });

  it('renders unknown default-branch status when commit is missing, without guessing main', async () => {
    expect.assertions(2);
    const listForRef = vi.fn();
    const octokit = makeOctokit({ pullRequests: [] });
    (octokit as { rest: { checks: { listForRef: typeof listForRef } } }).rest.checks.listForRef =
      listForRef;
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
    });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ defaultBranch: 'main', commit: null }),
    ]);

    expect(rows[0].defaultBranchStatus).toBe('unknown');
    expect(listForRef).not.toHaveBeenCalled();
  });

  it('treats missing pull_request_state rows as unknown decoration, not absence', async () => {
    expect.assertions(3);
    const octokit = makeOctokit({ pullRequests: [makePullRequest()] });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    const rows = await buildRepositoryDashboard(context, [makeRepository()]);

    expect(rows[0].pullRequests).toHaveLength(1);
    expect(rows[0].pullRequests[0].ciStatus).toBe('unknown');
    expect(rows[0].pullRequests[0].unresolvedThreadCount).toBeNull();
  });

  it('treats stale pull_request_state rows as unknown decoration', async () => {
    expect.assertions(2);
    const staleDate = new Date(Date.now() - (DEFAULT_STALE_AFTER_MS + 60_000));
    const octokit = makeOctokit({ pullRequests: [makePullRequest()] });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([
        makePullRequestState({ ciUpdatedAt: staleDate, ciStatus: 'failing' }),
      ]),
    });

    const rows = await buildRepositoryDashboard(context, [makeRepository()]);

    // Stale ciStatus renders unknown even though the stored value was 'failing'.
    expect(rows[0].pullRequests[0].ciStatus).toBe('unknown');
    expect(rows[0].attentionPullRequestCount).toBe(0);
  });

  it('flags repositories at the 100-item page cap', async () => {
    expect.assertions(1);
    const pullRequests = Array.from({ length: 100 }, (_, index) =>
      makePullRequest({ number: index + 1 }),
    );
    const octokit = makeOctokit({ pullRequests });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    const rows = await buildRepositoryDashboard(context, [makeRepository()]);

    expect(rows[0].openPullRequestCountAtCap).toBe(true);
  });

  it('renders no-installation rows without calling GitHub', async () => {
    expect.assertions(2);
    const getInstallationOctokit = vi.fn();
    const context = createMockContext({ getInstallationOctokit });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ installationId: null }),
    ]);

    expect(rows[0].dataStatus).toBe('unavailable');
    expect(getInstallationOctokit).not.toHaveBeenCalled();
  });

  it('renders a github-error row when inventory list fails for one repository, without failing the build', async () => {
    expect.assertions(3);
    const failingOctokit = makeOctokit({ listPullsError: new Error('boom') });
    const healthyOctokit = makeOctokit({ pullRequests: [makePullRequest()] });
    const getInstallationOctokit = vi
      .fn()
      .mockResolvedValueOnce(failingOctokit)
      .mockResolvedValueOnce(healthyOctokit);
    const context = createMockContext({
      getInstallationOctokit,
      db: withDbSelectResult([]),
    });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ id: 1 }),
      makeRepository({ id: 2 }),
    ]);

    expect(rows[0].dataStatus).toBe('unavailable');
    expect(rows[0].unavailableReason).toBe('github-error');
    expect(rows[1].dataStatus).toBe('ok');
  });

  it('trips the budget on a rate-limit error and stops calling GitHub for remaining repositories', async () => {
    expect.assertions(4);
    const rateLimitedOctokit = makeOctokit({ listPullsError: rateLimitError });
    const getInstallationOctokit = vi.fn().mockResolvedValue(rateLimitedOctokit);
    const context = createMockContext({ getInstallationOctokit });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ id: 1 }),
      makeRepository({ id: 2 }),
      makeRepository({ id: 3 }),
    ]);

    expect(rows[0].unavailableReason).toBe('rate-limited');
    expect(rows[1].unavailableReason).toBe('rate-limited');
    expect(rows[2].unavailableReason).toBe('rate-limited');
    // Only the first repository's installation octokit resolution is attempted;
    // the rest short-circuit before ever asking for an installation client.
    expect(getInstallationOctokit).toHaveBeenCalledTimes(1);
  });

  it('exhausts the api budget mid-dashboard and renders remaining repositories as unavailable without issuing more requests', async () => {
    expect.assertions(4);
    const octokit = makeOctokit({
      pullRequests: [],
      checkRuns: { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] },
    });
    const getInstallationOctokit = vi.fn().mockResolvedValue(octokit);
    const context = createMockContext({ getInstallationOctokit, db: withDbSelectResult([]) });

    // Budget of 2 covers exactly one repository's list + branch-CI calls.
    const rows = await buildRepositoryDashboard(
      context,
      [makeRepository({ id: 1 }), makeRepository({ id: 2 })],
      { apiBudget: 2 },
    );

    expect(rows[0].dataStatus).toBe('ok');
    expect(rows[1].dataStatus).toBe('unavailable');
    expect(rows[1].unavailableReason).toBe('api-budget-exhausted');
    expect(getInstallationOctokit).toHaveBeenCalledTimes(1);
  });

  it('always passes repositoryId to listPullRequests so it never bypasses the cache', async () => {
    expect.assertions(1);
    const list = vi.fn().mockResolvedValue({ data: [] });
    const octokit = { rest: { pulls: { list }, checks: { listForRef: vi.fn() } } } as never;
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    await buildRepositoryDashboard(context, [makeRepository({ id: 42 })]);

    // A repositoryId-aware call is keyed by repository ID under cachedRead's
    // list-pull-requests policy. Asserting the exact key (rather than "cache
    // was touched at all") ensures this fails if the dashboard ever calls
    // listPullRequests without repositoryId, even though the default-branch
    // CI read also touches the cache.
    const cacheKeys = (context.cache.getCached as ReturnType<typeof vi.fn>).mock.calls.map(
      ([key]) => key,
    );
    expect(cacheKeys).toContain(
      'github:repository:42:prs:list:s:open|sort:updated|dir:desc|p:1|pp:100',
    );
  });

  it('does not reuse a passing CI decoration recorded for a since-superseded head commit', async () => {
    expect.assertions(1);
    // The projection's ciStatus/ciUpdatedAt are fresh by wall-clock, but were
    // recorded for an earlier head commit ('old-head') than the PR's current
    // head ('new-head') — as happens when a new commit lands shortly after
    // the previous head's checks finished. The decoration must not be
    // replayed for the new commit.
    const octokit = makeOctokit({
      pullRequests: [makePullRequest({ head: { ref: 'feature', sha: 'new-head' } })],
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([makePullRequestState({ headSha: 'old-head', ciStatus: 'passing' })]),
    });

    const rows = await buildRepositoryDashboard(context, [makeRepository()]);

    expect(rows[0].pullRequests[0].ciStatus).toBe('unknown');
  });

  it('trusts a fresh CI decoration when the recorded head SHA matches the PR head', async () => {
    expect.assertions(1);
    const octokit = makeOctokit({
      pullRequests: [makePullRequest({ head: { ref: 'feature', sha: 'same-head' } })],
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([makePullRequestState({ headSha: 'same-head', ciStatus: 'passing' })]),
    });

    const rows = await buildRepositoryDashboard(context, [makeRepository()]);

    expect(rows[0].pullRequests[0].ciStatus).toBe('passing');
  });

  it('renders a github-error row (not no-installation) when installation token resolution throws', async () => {
    expect.assertions(2);
    const getInstallationOctokit = vi.fn().mockRejectedValue(new Error('token mint failed'));
    const context = createMockContext({ getInstallationOctokit });

    const rows = await buildRepositoryDashboard(context, [makeRepository()]);

    expect(rows[0].dataStatus).toBe('unavailable');
    expect(rows[0].unavailableReason).toBe('github-error');
  });

  it('marks the shared budget rate-limited when installation token resolution throws a rate-limit error', async () => {
    expect.assertions(3);
    const getInstallationOctokit = vi.fn().mockRejectedValue(rateLimitError);
    const context = createMockContext({ getInstallationOctokit });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ id: 1 }),
      makeRepository({ id: 2 }),
    ]);

    expect(rows[0].unavailableReason).toBe('rate-limited');
    // The budget trips for the whole build, so the second repository never
    // even attempts to resolve an installation client.
    expect(rows[1].unavailableReason).toBe('rate-limited');
    expect(getInstallationOctokit).toHaveBeenCalledTimes(1);
  });
});
