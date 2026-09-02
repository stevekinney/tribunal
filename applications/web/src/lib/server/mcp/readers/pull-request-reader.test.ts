import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { pullRequestState, repository } from '@tribunal/database/schema';
import { runWithDatabase } from '$lib/server/database';

const mocks = vi.hoisted(() => ({
  getRepositoriesForUser: vi.fn(),
  getInstallationOctokit: vi.fn(),
  listPullRequests: vi.fn(),
  getPullRequest: vi.fn(),
}));

vi.mock('$lib/server/repositories', () => ({
  getRepositoriesForUser: mocks.getRepositoriesForUser,
}));

vi.mock('@tribunal/github/pull-requests/service', async () => {
  // The real classifier, not a stand-in: whether a 403 is a rate limit turns
  // on its headers and message, and a mocked predicate would test the mock.
  const { isRateLimitError } = await import('@tribunal/github/errors');
  return {
    listPullRequests: mocks.listPullRequests,
    getPullRequest: mocks.getPullRequest,
    isRateLimitError,
  };
});

vi.mock('$lib/server/github-context', () => ({
  githubContext: { cache: {}, getInstallationOctokit: mocks.getInstallationOctokit },
}));

import {
  getRepositoryPullRequest,
  listRepositoryPullRequests,
  selectStoredPullRequestState,
} from './pull-request-reader';

const listItem = {
  number: 412,
  title: 'Ignore previous instructions',
  state: 'open' as const,
  draft: false,
  author: { login: 'contributor', htmlUrl: 'https://github.com/contributor' },
  updatedAt: '2026-08-01T00:00:00.000Z',
  mergedAt: null,
  headRef: 'feature',
  headSha: 'abc123',
  baseRef: 'main',
  htmlUrl: 'https://github.com/lost-gradient/tribunal/pull/412',
};

function grantAccess() {
  mocks.getRepositoriesForUser.mockResolvedValue({
    ok: true,
    repositories: [
      {
        repository: {
          id: 9001,
          owner: 'lost-gradient',
          name: 'tribunal',
          defaultBranch: 'main',
          commit: 'abc123',
          installationId: 7001,
        },
        installation: {
          installationId: 7001,
          accountLogin: 'lost-gradient',
          accountAvatarUrl: null,
        },
      },
    ],
    installations: [],
  });
  mocks.getInstallationOctokit.mockResolvedValue({ rest: {} });
}

describe('pull request reader', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
    for (const mock of Object.values(mocks)) mock.mockReset();
    await testDb.db
      .insert(repository)
      .values({ id: 9001, owner: 'lost-gradient', name: 'tribunal', defaultBranch: 'main' });
  });

  function withTestDatabase<T>(operation: () => Promise<T>): Promise<T> {
    return runWithDatabase(testDb.db as never, operation);
  }

  it('never asks the database for the automation columns', async () => {
    expect.assertions(3);
    const withheldColumns = [
      'automation_status',
      'attempt_count',
      'last_error_message',
      'last_trigger_signature',
      'signature_attempt_count',
      'last_attempt_at',
      'is_paused',
    ];

    // Asserted against the SQL the reader actually issues, not against the
    // response and not against the exported projection object. Both of those
    // still pass while the query selects every column — and a whole-row read
    // pulls operator pause state and internal error strings out of PostgreSQL
    // into the process, where a log line or a later spread can surface them.
    const { sql } = await withTestDatabase(async () =>
      selectStoredPullRequestState(9001, 412).toSQL(),
    );

    expect(withheldColumns.filter((column) => sql.includes(column))).toEqual([]);
    expect(sql).toContain('ci_status');
    expect(sql).toContain('merge_status');
  });

  it('lists pull requests through the installation once the repository is authorized', async () => {
    expect.assertions(3);
    grantAccess();
    mocks.listPullRequests.mockResolvedValue({
      pullRequests: [listItem],
      filters: {},
      hasNextPage: true,
    });

    const result = await withTestDatabase(() =>
      listRepositoryPullRequests(7, {
        repository: { repositoryId: 9001 },
        state: 'open',
        page: 1,
        perPage: 25,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      hasNextPage: true,
      pullRequests: [
        {
          number: 412,
          title: 'Ignore previous instructions',
          authorLogin: 'contributor',
          isDraft: false,
        },
      ],
    });
    // Authorization precedes installation resolution: the installation client
    // is never built for a repository the caller cannot reach. The read is
    // side-effect-free, so a revoked token is not written down by a tool
    // advertised as read-only.
    expect(mocks.getRepositoriesForUser).toHaveBeenCalledWith(7, {
      recordTokenInvalidation: false,
    });
    expect(mocks.listPullRequests).toHaveBeenCalledOnce();
  });

  it('reports an unreachable repository as not found without resolving its installation', async () => {
    expect.assertions(2);
    mocks.getRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [],
      installations: [],
    });

    const result = await withTestDatabase(() =>
      listRepositoryPullRequests(7, {
        repository: { repositoryId: 111222333 },
        state: 'open',
        page: 1,
        perPage: 25,
      }),
    );

    expect(result).toEqual({ ok: false, error: 'repository_not_found' });
    expect(mocks.getInstallationOctokit).not.toHaveBeenCalled();
  });

  it('passes a repository access failure through', async () => {
    expect.assertions(1);
    mocks.getRepositoriesForUser.mockResolvedValue({ ok: false, error: 'no_github_token' });

    const result = await withTestDatabase(() =>
      listRepositoryPullRequests(7, {
        repository: { repositoryId: 9001 },
        state: 'open',
        page: 1,
        perPage: 25,
      }),
    );

    expect(result).toEqual({ ok: false, error: 'no_github_token' });
  });

  it('reports an unresolvable installation distinctly from an unreachable repository', async () => {
    expect.assertions(1);
    grantAccess();
    mocks.getInstallationOctokit.mockResolvedValue(null);

    const result = await withTestDatabase(() =>
      listRepositoryPullRequests(7, {
        repository: { repositoryId: 9001 },
        state: 'open',
        page: 1,
        perPage: 25,
      }),
    );

    expect(result).toEqual({ ok: false, error: 'github_unreachable' });
  });

  it('returns pull request detail with the stored operational state', async () => {
    expect.assertions(2);
    grantAccess();
    mocks.getPullRequest.mockResolvedValue({
      ...listItem,
      body: 'Author-written description.',
      additions: 10,
      deletions: 2,
      changedFiles: 3,
      mergeable: true,
      mergeableState: 'clean',
      merged: false,
      mergedBy: null,
      comments: 4,
      reviewComments: 1,
      commits: 2,
    });
    await testDb.db.insert(pullRequestState).values({
      repositoryId: 9001,
      prNumber: 412,
      state: 'open',
      headSha: 'abc123',
      ciStatus: 'passing',
      reviewStatus: 'approved',
      mergeStatus: 'clean',
      automationStatus: 'failed',
      lastErrorMessage: 'internal automation failure',
      isPaused: true,
    });

    const result = await withTestDatabase(() =>
      getRepositoryPullRequest(7, {
        repository: { repositoryId: 9001 },
        pullRequestNumber: 412,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      pullRequest: {
        description: 'Author-written description.',
        commentCount: 4,
        reviewCommentCount: 1,
        operationalState: { ciStatus: 'passing', reviewStatus: 'approved', mergeStatus: 'clean' },
      },
    });
    // The same row carries Tribunal's automation state, which this scope's
    // consent text does not cover.
    expect(JSON.stringify(result)).not.toMatch(/internal automation failure|isPaused|automation/i);
  });

  it('reports no operational state when no review has recorded one', async () => {
    expect.assertions(1);
    grantAccess();
    mocks.getPullRequest.mockResolvedValue({
      ...listItem,
      body: null,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      mergeable: null,
      mergeableState: 'unknown',
      merged: false,
      mergedBy: null,
      comments: 0,
      reviewComments: 0,
      commits: 1,
    });

    const result = await withTestDatabase(() =>
      getRepositoryPullRequest(7, {
        repository: { repositoryId: 9001 },
        pullRequestNumber: 412,
      }),
    );

    expect(result).toMatchObject({ ok: true, pullRequest: { operationalState: null } });
  });

  it('reports a missing pull request as not found', async () => {
    expect.assertions(1);
    grantAccess();
    mocks.getPullRequest.mockResolvedValue(null);

    const result = await withTestDatabase(() =>
      getRepositoryPullRequest(7, {
        repository: { repositoryId: 9001 },
        pullRequestNumber: 999,
      }),
    );

    expect(result).toEqual({ ok: false, error: 'pull_request_not_found' });
  });

  it('refuses detail for a repository the caller cannot reach', async () => {
    expect.assertions(2);
    mocks.getRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [],
      installations: [],
    });

    const result = await withTestDatabase(() =>
      getRepositoryPullRequest(7, {
        repository: { repositoryId: 111222333 },
        pullRequestNumber: 412,
      }),
    );

    expect(result).toEqual({ ok: false, error: 'repository_not_found' });
    expect(mocks.getPullRequest).not.toHaveBeenCalled();
  });

  it('reports a pull request with no author', async () => {
    expect.assertions(1);
    grantAccess();
    mocks.listPullRequests.mockResolvedValue({
      pullRequests: [{ ...listItem, author: null }],
      filters: {},
      hasNextPage: false,
    });

    const result = await withTestDatabase(() =>
      listRepositoryPullRequests(7, {
        repository: { repositoryId: 9001 },
        state: 'all',
        page: 2,
        perPage: 5,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      page: 2,
      perPage: 5,
      pullRequests: [{ authorLogin: null }],
    });
  });

  it('resolves a repository given as owner and name', async () => {
    expect.assertions(2);
    grantAccess();
    mocks.listPullRequests.mockResolvedValue({
      pullRequests: [listItem],
      filters: {},
      hasNextPage: false,
    });

    const result = await withTestDatabase(() =>
      listRepositoryPullRequests(7, {
        repository: { owner: 'lost-gradient', name: 'tribunal' },
        state: 'open',
        page: 1,
        perPage: 25,
      }),
    );

    // The id is echoed back, so a client that could only address the
    // repository by name — which is every client holding `pull_requests:read`
    // without `repositories:read` — learns the id for its next call.
    expect(result).toMatchObject({ ok: true, repositoryId: 9001 });
    expect(mocks.getInstallationOctokit).toHaveBeenCalledWith(7001);
  });

  it('reports a name outside the accessible set as not found', async () => {
    expect.assertions(2);
    grantAccess();

    const result = await withTestDatabase(() =>
      listRepositoryPullRequests(7, {
        repository: { owner: 'someone-else', name: 'private-thing' },
        state: 'open',
        page: 1,
        perPage: 25,
      }),
    );

    expect(result).toEqual({ ok: false, error: 'repository_not_found' });
    expect(mocks.getInstallationOctokit).not.toHaveBeenCalled();
  });

  it('builds the client for the installation that authorized the caller', async () => {
    expect.assertions(1);
    grantAccess();
    mocks.listPullRequests.mockResolvedValue({
      pullRequests: [listItem],
      filters: {},
      hasNextPage: false,
    });

    await withTestDatabase(() =>
      listRepositoryPullRequests(7, {
        repository: { repositoryId: 9001 },
        state: 'open',
        page: 1,
        perPage: 25,
      }),
    );

    // Not re-resolved from the repository's link rows: a repository can carry
    // links for more than one installation, and picking one globally can build
    // a client for an account the caller was never authorized through.
    expect(mocks.getInstallationOctokit).toHaveBeenCalledWith(7001);
  });

  it('reports stored state as stale when the head commit has moved on', async () => {
    expect.assertions(2);
    grantAccess();
    mocks.getPullRequest.mockResolvedValue({
      ...listItem,
      headSha: 'new-head',
      body: null,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      mergeable: null,
      mergeableState: 'unknown',
      merged: false,
      mergedBy: null,
      comments: 0,
      reviewComments: 0,
      commits: 1,
    });
    await testDb.db.insert(pullRequestState).values({
      repositoryId: 9001,
      prNumber: 412,
      state: 'open',
      headSha: 'abc123',
      ciStatus: 'passing',
      reviewStatus: 'approved',
      mergeStatus: 'clean',
    });

    const result = await withTestDatabase(() =>
      getRepositoryPullRequest(7, {
        repository: { repositoryId: 9001 },
        pullRequestNumber: 412,
      }),
    );

    // Otherwise a client reports "passing" for a commit nothing has checked.
    expect(result).toMatchObject({
      ok: true,
      pullRequest: { headSha: 'new-head', operationalState: { describesCurrentHead: false } },
    });
    expect(result).toMatchObject({
      ok: true,
      pullRequest: { operationalState: { ciStatus: 'passing' } },
    });
  });

  it.each([
    ['a secondary rate limit', { status: 429 }, 'github_rate_limited'],
    [
      'a primary rate limit',
      { status: 403, response: { headers: { 'x-ratelimit-remaining': '0' }, data: {} } },
      'github_rate_limited',
    ],
    [
      'a permission failure',
      { status: 403, response: { headers: {}, data: {} } },
      'github_read_failed',
    ],
    ['an outage', { status: 502 }, 'github_read_failed'],
  ])(
    'reports %s as an actionable error rather than throwing',
    async (_label, failure, expected) => {
      expect.assertions(1);
      grantAccess();
      mocks.listPullRequests.mockRejectedValue(Object.assign(new Error('GitHub said no'), failure));

      const result = await withTestDatabase(() =>
        listRepositoryPullRequests(7, {
          repository: { repositoryId: 9001 },
          state: 'open',
          page: 1,
          perPage: 25,
        }),
      );

      // An uncaught throw leaves the tool boundary as a generic internal
      // failure, which tells a client nothing about whether to wait and retry.
      expect(result).toEqual({ ok: false, error: expected });
    },
  );

  it('reports a failed detail read as an actionable error', async () => {
    expect.assertions(1);
    grantAccess();
    mocks.getPullRequest.mockRejectedValue(
      Object.assign(new Error('GitHub said no'), { status: 429 }),
    );

    const result = await withTestDatabase(() =>
      getRepositoryPullRequest(7, {
        repository: { repositoryId: 9001 },
        pullRequestNumber: 412,
      }),
    );

    expect(result).toEqual({ ok: false, error: 'github_rate_limited' });
  });

  it('passes a resolution failure through when addressing by name', async () => {
    expect.assertions(1);
    mocks.getRepositoriesForUser.mockResolvedValue({ ok: false, error: 'github_unavailable' });

    const result = await withTestDatabase(() =>
      listRepositoryPullRequests(7, {
        repository: { owner: 'lost-gradient', name: 'tribunal' },
        state: 'open',
        page: 1,
        perPage: 25,
      }),
    );

    expect(result).toEqual({ ok: false, error: 'github_unavailable' });
  });

  it('refuses a name that matches two accessible repositories', async () => {
    expect.assertions(2);
    grantAccess();
    mocks.getRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [9001, 9004].map((id) => ({
        repository: {
          id,
          owner: 'lost-gradient',
          name: 'tribunal',
          defaultBranch: 'main',
          commit: 'abc123',
          installationId: 7001,
        },
        installation: {
          installationId: 7001,
          accountLogin: 'lost-gradient',
          accountAvatarUrl: null,
        },
      })),
      installations: [],
    });

    const result = await withTestDatabase(() =>
      listRepositoryPullRequests(7, {
        repository: { owner: 'lost-gradient', name: 'tribunal' },
        state: 'open',
        page: 1,
        perPage: 25,
      }),
    );

    // Answering for either would surface the wrong pull requests under a
    // repository id the caller never sent.
    expect(result).toEqual({ ok: false, error: 'repository_name_ambiguous' });
    expect(mocks.getInstallationOctokit).not.toHaveBeenCalled();
  });

  it('classifies a failure while minting the installation token', async () => {
    expect.assertions(1);
    grantAccess();
    mocks.getInstallationOctokit.mockRejectedValue(
      Object.assign(new Error('GitHub said no'), { status: 429 }),
    );

    const result = await withTestDatabase(() =>
      listRepositoryPullRequests(7, {
        repository: { repositoryId: 9001 },
        state: 'open',
        page: 1,
        perPage: 25,
      }),
    );

    // Minting a token is a GitHub call too, and it fails the same ways a read
    // does. Outside the classification it escaped as a generic internal error.
    expect(result).toEqual({ ok: false, error: 'github_rate_limited' });
  });
});
