import { describe, it, expect, vi } from 'vitest';
import type { GithubServiceContext } from '../context.js';
import { CACHE_KEYS } from '../cache-keys.js';
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
  getBranch?: ReturnType<typeof vi.fn>;
  getBranchRules?: ReturnType<typeof vi.fn>;
  getCombinedStatusForRef?: ReturnType<typeof vi.fn>;
}) {
  const list = options.listPullsError
    ? vi.fn().mockRejectedValue(options.listPullsError)
    : vi.fn().mockResolvedValue({ data: options.pullRequests ?? [] });

  const listForRef = options.checksError
    ? vi.fn().mockRejectedValue(options.checksError)
    : vi.fn().mockResolvedValue({ data: options.checkRuns ?? { total_count: 0, check_runs: [] } });

  // Gated on total_count > 0 in paginateCheckRunsRollup, so this default
  // (empty) combined-status response never changes existing expectations.
  const getCombinedStatusForRef =
    options.getCombinedStatusForRef ??
    vi.fn().mockResolvedValue({ data: { total_count: 0, state: 'pending' } });

  // Repositories with no rulesets simply have no rules for the branch — an
  // empty array, not an error — so this default never changes existing
  // classic-protection-only expectations.
  const getBranchRules = options.getBranchRules ?? vi.fn().mockResolvedValue({ data: [] });

  return {
    rest: {
      pulls: { list },
      checks: { listForRef },
      repos: {
        getCombinedStatusForRef,
        getBranchRules,
        ...(options.getBranch ? { getBranch: options.getBranch } : {}),
      },
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

  it('narrows default-branch CI to required checks so a failed non-required workflow does not fail CI', async () => {
    expect.assertions(1);
    const getBranch = vi.fn().mockResolvedValue({
      data: {
        commit: { sha: 'resolved-sha' },
        protection: { required_status_checks: { contexts: ['Unit Tests'], checks: [] } },
      },
    });
    const octokit = makeOctokit({
      pullRequests: [],
      checkRuns: {
        total_count: 2,
        check_runs: [
          { name: 'Unit Tests', status: 'completed', conclusion: 'success' },
          { name: 'Deploy Production', status: 'completed', conclusion: 'failure' },
        ],
      },
      getBranch,
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ defaultBranch: 'main', commit: null }),
    ]);

    // 'Deploy Production' is not a required check, so its failure is excluded.
    expect(rows[0].defaultBranchStatus).toBe('passing');
  });

  it('narrows default-branch CI to a required check defined only via a repository ruleset', async () => {
    expect.assertions(2);
    // No classic branch protection at all — the required check comes solely
    // from the ruleset response, which `getBranch` never surfaces.
    const getBranch = vi.fn().mockResolvedValue({ data: { commit: { sha: 'resolved-sha' } } });
    const getBranchRules = vi.fn().mockResolvedValue({
      data: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'Unit Tests' }] },
        },
      ],
    });
    const octokit = makeOctokit({
      pullRequests: [],
      checkRuns: {
        total_count: 2,
        check_runs: [
          { name: 'Unit Tests', status: 'completed', conclusion: 'success' },
          { name: 'Deploy Production', status: 'completed', conclusion: 'failure' },
        ],
      },
      getBranch,
      getBranchRules,
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ defaultBranch: 'main', commit: null }),
    ]);

    expect(getBranchRules).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      branch: 'main',
      per_page: 100,
      page: 1,
    });
    // 'Deploy Production' is not required by the ruleset, so its failure is excluded.
    expect(rows[0].defaultBranchStatus).toBe('passing');
  });

  it('does not duplicate a required check mirrored in both `contexts` and `checks[]`', async () => {
    expect.assertions(1);
    // GitHub mirrors every `checks[]` entry's context into the legacy
    // `contexts` list — the same required check appears in both.
    const getBranch = vi.fn().mockResolvedValue({
      data: {
        commit: { sha: 'resolved-sha' },
        protection: {
          required_status_checks: {
            contexts: ['Unit Tests'],
            checks: [{ context: 'Unit Tests', app_id: 42 }],
          },
        },
      },
    });
    const octokit = makeOctokit({
      pullRequests: [],
      checkRuns: {
        total_count: 1,
        check_runs: [
          { name: 'Unit Tests', status: 'completed', conclusion: 'success', app: { id: 42 } },
        ],
      },
      getBranch,
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ defaultBranch: 'main', commit: null }),
    ]);

    // Without de-duplication, the unpinned `contexts` entry would match
    // first, never marking the pinned `checks[]` entry as seen — reporting
    // a false "pending" even though the app-42 check run passed.
    expect(rows[0].defaultBranchStatus).toBe('passing');
  });

  it('pages through every branch-rules page to find a required_status_checks rule past page 1', async () => {
    expect.assertions(2);
    const getBranch = vi.fn().mockResolvedValue({ data: { commit: { sha: 'resolved-sha' } } });
    const page1 = Array.from({ length: 100 }, () => ({ type: 'creation' }));
    const page2 = [
      {
        type: 'required_status_checks',
        parameters: { required_status_checks: [{ context: 'Unit Tests' }] },
      },
    ];
    const getBranchRules = vi
      .fn()
      .mockResolvedValueOnce({ data: page1 })
      .mockResolvedValueOnce({ data: page2 });
    const octokit = makeOctokit({
      pullRequests: [],
      checkRuns: {
        total_count: 2,
        check_runs: [
          { name: 'Unit Tests', status: 'completed', conclusion: 'success' },
          { name: 'Deploy Production', status: 'completed', conclusion: 'failure' },
        ],
      },
      getBranch,
      getBranchRules,
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ defaultBranch: 'main', commit: null }),
    ]);

    expect(getBranchRules).toHaveBeenCalledTimes(2);
    // The required_status_checks rule only exists on page 2 — a single-page
    // read would miss it and fall back to counting every check run.
    expect(rows[0].defaultBranchStatus).toBe('passing');
  });

  it('does not cache a partial ruleset page set when the budget runs out mid-pagination', async () => {
    expect.assertions(2);
    const getBranch = vi.fn().mockResolvedValue({ data: { commit: { sha: 'resolved-sha' } } });
    // A full page (100 items, no required_status_checks rule) forces a
    // second page — but the budget runs out before it can be fetched.
    const page1 = Array.from({ length: 100 }, () => ({ type: 'creation' }));
    const getBranchRules = vi.fn().mockResolvedValueOnce({ data: page1 });
    const octokit = makeOctokit({
      pullRequests: [],
      checkRuns: {
        total_count: 2,
        check_runs: [
          { name: 'Unit Tests', status: 'completed', conclusion: 'success' },
          { name: 'Deploy Production', status: 'completed', conclusion: 'failure' },
        ],
      },
      getBranch,
      getBranchRules,
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    // Budget: 1 for listPullRequests, 1 for get-branch-head-sha, 1 for
    // ruleset page 1 — exhausted right before ruleset page 2, and before
    // there's any budget left for the check-run rollup itself.
    const rows = await buildRepositoryDashboard(
      context,
      [makeRepository({ defaultBranch: 'main', commit: null })],
      { apiBudget: 3 },
    );

    // The ruleset read throws instead of silently caching a partial,
    // rule-missing page 1 — degrading (here) all the way to `unknown` since
    // the budget is also exhausted for the check-run rollup, rather than a
    // false green built on an incomplete required-check set.
    expect(rows[0].defaultBranchStatus).toBe('unknown');
    expect(context.cache.setCache).not.toHaveBeenCalledWith(
      'github:response:acme:widgets:branch:main:rules',
      expect.anything(),
      expect.anything(),
    );
  });

  it('converts a pre-#156 cached envelope (requiredCheckNames) instead of dropping it', async () => {
    expect.assertions(1);
    const octokit = makeOctokit({
      pullRequests: [],
      checkRuns: {
        total_count: 2,
        check_runs: [
          { name: 'Unit Tests', status: 'completed', conclusion: 'success' },
          { name: 'Deploy Production', status: 'completed', conclusion: 'failure' },
        ],
      },
    });
    const now = Date.now();
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
      cache: {
        getCached: vi.fn(async (key: string) => {
          if (key === CACHE_KEYS.GITHUB_BRANCH_HEAD_SHA('acme', 'widgets', 'main')) {
            return {
              // Pre-#156 shape: no `requiredChecks` field.
              value: { sha: 'commit-sha-1', requiredCheckNames: ['Unit Tests'] },
              fetchedAt: now,
              expiresAt: now + 30_000,
              source: 'cache',
            };
          }
          return null;
        }),
        setCache: vi.fn().mockResolvedValue(true),
        setCacheIndefinitely: vi.fn().mockResolvedValue(true),
        deleteCache: vi.fn().mockResolvedValue(true),
        deleteCacheByPattern: vi.fn().mockResolvedValue(0),
        resetCacheClient: vi.fn(),
      },
    });

    const rows = await buildRepositoryDashboard(context, [makeRepository()]);

    // Converted (as unpinned) rather than dropped — 'Deploy Production' is
    // excluded from the rollup, so its failure doesn't fail CI.
    expect(rows[0].defaultBranchStatus).toBe('passing');
  });

  it('merges required checks from classic branch protection and a ruleset', async () => {
    expect.assertions(1);
    const getBranch = vi.fn().mockResolvedValue({
      data: {
        commit: { sha: 'resolved-sha' },
        protection: { required_status_checks: { contexts: ['Unit Tests'], checks: [] } },
      },
    });
    const getBranchRules = vi.fn().mockResolvedValue({
      data: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'Lint' }] },
        },
      ],
    });
    const octokit = makeOctokit({
      pullRequests: [],
      checkRuns: {
        total_count: 2,
        check_runs: [{ name: 'Unit Tests', status: 'completed', conclusion: 'success' }],
      },
      getBranch,
      getBranchRules,
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ defaultBranch: 'main', commit: null }),
    ]);

    // 'Lint' (ruleset-only) is required but hasn't reported — still pending
    // even though the classic-protection required check ('Unit Tests') passed.
    expect(rows[0].defaultBranchStatus).toBe('pending');
  });

  it('prefers a ruleset-pinned requirement over classic protection leaving the same context unpinned', async () => {
    expect.assertions(1);
    // Classic protection requires 'Unit Tests' unpinned; a ruleset also
    // requires 'Unit Tests', pinned to app 42.
    const getBranch = vi.fn().mockResolvedValue({
      data: {
        commit: { sha: 'resolved-sha' },
        protection: { required_status_checks: { contexts: ['Unit Tests'], checks: [] } },
      },
    });
    const getBranchRules = vi.fn().mockResolvedValue({
      data: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'Unit Tests', integration_id: 42 }] },
        },
      ],
    });
    const octokit = makeOctokit({
      pullRequests: [],
      // A run from exactly the pinned app (42) — satisfies the ruleset's
      // pinned requirement.
      checkRuns: {
        total_count: 1,
        check_runs: [
          { name: 'Unit Tests', status: 'completed', conclusion: 'success', app: { id: 42 } },
        ],
      },
      getBranch,
      getBranchRules,
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ defaultBranch: 'main', commit: null }),
    ]);

    // Without preferring the pinned entry, the unpinned classic-protection
    // duplicate for the same context would be matched (and marked seen)
    // first, leaving the ruleset's pinned entry permanently unseen and the
    // rollup stuck at `pending` even though the app-42 run passed.
    expect(rows[0].defaultBranchStatus).toBe('passing');
  });

  it('falls back to classic-protection-only required checks when the ruleset read fails', async () => {
    expect.assertions(1);
    const getBranch = vi.fn().mockResolvedValue({
      data: {
        commit: { sha: 'resolved-sha' },
        protection: { required_status_checks: { contexts: ['Unit Tests'], checks: [] } },
      },
    });
    const getBranchRules = vi.fn().mockRejectedValue(new Error('rulesets not available'));
    const octokit = makeOctokit({
      pullRequests: [],
      checkRuns: {
        total_count: 2,
        check_runs: [
          { name: 'Unit Tests', status: 'completed', conclusion: 'success' },
          { name: 'Deploy Production', status: 'completed', conclusion: 'failure' },
        ],
      },
      getBranch,
      getBranchRules,
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ defaultBranch: 'main', commit: null }),
    ]);

    // Ruleset read failed — degrade to the classic-protection required set
    // rather than rendering the whole branch status unavailable.
    expect(rows[0].defaultBranchStatus).toBe('passing');
  });

  it('resolves the branch head live (via cachedRead) when commit is missing, instead of staying unknown forever', async () => {
    expect.assertions(4);
    const getBranch = vi.fn().mockResolvedValue({ data: { commit: { sha: 'resolved-sha' } } });
    const octokit = makeOctokit({
      pullRequests: [],
      checkRuns: { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] },
      getBranch,
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ defaultBranch: 'main', commit: null }),
    ]);

    expect(getBranch).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets', branch: 'main' });
    // The resolved SHA is cached under the dedicated branch-head-sha key so
    // the next dashboard build (or a cache hit within the TTL) doesn't repeat
    // the live call.
    expect(context.cache.setCache).toHaveBeenCalledWith(
      CACHE_KEYS.GITHUB_BRANCH_HEAD_SHA('acme', 'widgets', 'main'),
      expect.anything(),
      expect.anything(),
    );
    expect(rows[0].defaultBranchStatus).toBe('passing');
    // The resolved SHA (not the missing stored one) drives the CI lookup.
    expect(octokit.rest.checks.listForRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'resolved-sha' }),
    );
  });

  it('uses the live branch head instead of a stale stored commit after a push', async () => {
    expect.assertions(3);
    const getBranch = vi.fn().mockResolvedValue({ data: { commit: { sha: 'new-push-sha' } } });
    const octokit = makeOctokit({
      pullRequests: [],
      checkRuns: { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] },
      getBranch,
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ defaultBranch: 'main', commit: 'stale-stored-sha' }),
    ]);

    expect(getBranch).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets', branch: 'main' });
    expect(octokit.rest.checks.listForRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'new-push-sha' }),
    );
    expect(rows[0].defaultBranchStatus).toBe('passing');
  });

  it('serves a cached branch head SHA without a live getBranch call', async () => {
    expect.assertions(2);
    const getBranch = vi.fn();
    const octokit = makeOctokit({
      pullRequests: [],
      checkRuns: { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] },
      getBranch,
    });
    const now = Date.now();
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
      cache: {
        getCached: vi.fn(async (key: string) => {
          if (key === CACHE_KEYS.GITHUB_BRANCH_HEAD_SHA('acme', 'widgets', 'main')) {
            return {
              value: 'cached-sha',
              fetchedAt: now,
              expiresAt: now + 60_000,
              source: 'cache',
            };
          }
          return null;
        }),
        setCache: vi.fn().mockResolvedValue(true),
        setCacheIndefinitely: vi.fn().mockResolvedValue(true),
        deleteCache: vi.fn().mockResolvedValue(true),
        deleteCacheByPattern: vi.fn().mockResolvedValue(0),
        resetCacheClient: vi.fn(),
      },
    });

    const rows = await buildRepositoryDashboard(context, [
      makeRepository({ defaultBranch: 'main', commit: null }),
    ]);

    expect(getBranch).not.toHaveBeenCalled();
    expect(rows[0].defaultBranchStatus).toBe('passing');
  });

  it('does not attempt a live branch-head lookup once the api budget is exhausted', async () => {
    expect.assertions(2);
    const getBranch = vi.fn().mockResolvedValue({ data: { commit: { sha: 'resolved-sha' } } });
    const octokit = makeOctokit({ pullRequests: [], getBranch });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([]),
    });

    // Budget of 1 covers only the pull-request inventory call.
    const rows = await buildRepositoryDashboard(
      context,
      [makeRepository({ defaultBranch: 'main', commit: null })],
      { apiBudget: 1 },
    );

    expect(rows[0].defaultBranchStatus).toBe('unknown');
    expect(getBranch).not.toHaveBeenCalled();
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

  it('does not reuse a merge decoration recorded for a since-superseded head commit', async () => {
    expect.assertions(1);
    // Mirrors the CI head-mismatch regression test above: a new head commit
    // landed before the `synchronize` event's projection update, so the
    // stored `mergeStatus` describes the previous head — it must not be
    // replayed for the new commit even though it is fresh by wall-clock.
    const octokit = makeOctokit({
      pullRequests: [makePullRequest({ head: { ref: 'feature', sha: 'new-head' } })],
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([makePullRequestState({ headSha: 'old-head', mergeStatus: 'clean' })]),
    });

    const rows = await buildRepositoryDashboard(context, [makeRepository()]);

    expect(rows[0].pullRequests[0].mergeStatus).toBe('unknown');
  });

  it('trusts a fresh merge decoration when the recorded head SHA matches the PR head', async () => {
    expect.assertions(1);
    const octokit = makeOctokit({
      pullRequests: [makePullRequest({ head: { ref: 'feature', sha: 'same-head' } })],
    });
    const context = createMockContext({
      getInstallationOctokit: vi.fn().mockResolvedValue(octokit),
      db: withDbSelectResult([
        makePullRequestState({ headSha: 'same-head', mergeStatus: 'clean' }),
      ]),
    });

    const rows = await buildRepositoryDashboard(context, [makeRepository()]);

    expect(rows[0].pullRequests[0].mergeStatus).toBe('clean');
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
