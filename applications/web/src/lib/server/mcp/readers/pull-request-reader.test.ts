import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { pullRequestState, repository } from '@tribunal/database/schema';
import { runWithDatabase } from '$lib/server/database';

const mocks = vi.hoisted(() => ({
  getRepositoriesForUser: vi.fn(),
  getInstallationForRepository: vi.fn(),
  listPullRequests: vi.fn(),
  getPullRequest: vi.fn(),
}));

vi.mock('$lib/server/repositories', () => ({
  getRepositoriesForUser: mocks.getRepositoriesForUser,
}));

vi.mock('@tribunal/github/repositories/service', () => ({
  getInstallationForRepository: mocks.getInstallationForRepository,
}));

vi.mock('@tribunal/github/pull-requests/service', () => ({
  listPullRequests: mocks.listPullRequests,
  getPullRequest: mocks.getPullRequest,
}));

vi.mock('$lib/server/github-context', () => ({ githubContext: { cache: {} } }));

import {
  getRepositoryPullRequest,
  listRepositoryPullRequests,
  pullRequestStateProjection,
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
  mocks.getInstallationForRepository.mockResolvedValue({
    ok: true,
    octokit: { rest: {} },
    owner: 'lost-gradient',
    repo: 'tribunal',
    installationId: 7001,
  });
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

  it('never asks the database for the automation columns', () => {
    expect.assertions(1);
    const withheldColumns = [
      'automationStatus',
      'attemptCount',
      'lastErrorMessage',
      'lastTriggerSignature',
      'signatureAttemptCount',
      'lastAttemptAt',
      'isPaused',
      'id',
      'createdAt',
      'updatedAt',
    ];

    // Asserted against the projection the query is built from, not against the
    // response: filtering while assembling the response would still have
    // pulled operator pause state and internal error strings out of
    // PostgreSQL, where a log line or a later spread could surface them.
    expect(
      Object.keys(pullRequestStateProjection).filter((column) => withheldColumns.includes(column)),
    ).toEqual([]);
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
        repositoryId: 9001,
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
    // is never built for a repository the caller cannot reach.
    expect(mocks.getRepositoriesForUser).toHaveBeenCalledWith(7);
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
        repositoryId: 111222333,
        state: 'open',
        page: 1,
        perPage: 25,
      }),
    );

    expect(result).toEqual({ ok: false, error: 'repository_not_found' });
    expect(mocks.getInstallationForRepository).not.toHaveBeenCalled();
  });

  it('passes a repository access failure through', async () => {
    expect.assertions(1);
    mocks.getRepositoriesForUser.mockResolvedValue({ ok: false, error: 'no_github_token' });

    const result = await withTestDatabase(() =>
      listRepositoryPullRequests(7, { repositoryId: 9001, state: 'open', page: 1, perPage: 25 }),
    );

    expect(result).toEqual({ ok: false, error: 'no_github_token' });
  });

  it('reports an unresolvable installation distinctly from an unreachable repository', async () => {
    expect.assertions(1);
    grantAccess();
    mocks.getInstallationForRepository.mockResolvedValue({
      ok: false,
      error: 'Installation not found',
      code: 'not_found',
    });

    const result = await withTestDatabase(() =>
      listRepositoryPullRequests(7, { repositoryId: 9001, state: 'open', page: 1, perPage: 25 }),
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
      getRepositoryPullRequest(7, { repositoryId: 9001, pullRequestNumber: 412 }),
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
      getRepositoryPullRequest(7, { repositoryId: 9001, pullRequestNumber: 412 }),
    );

    expect(result).toMatchObject({ ok: true, pullRequest: { operationalState: null } });
  });

  it('reports a missing pull request as not found', async () => {
    expect.assertions(1);
    grantAccess();
    mocks.getPullRequest.mockResolvedValue(null);

    const result = await withTestDatabase(() =>
      getRepositoryPullRequest(7, { repositoryId: 9001, pullRequestNumber: 999 }),
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
      getRepositoryPullRequest(7, { repositoryId: 111222333, pullRequestNumber: 412 }),
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
      listRepositoryPullRequests(7, { repositoryId: 9001, state: 'all', page: 2, perPage: 5 }),
    );

    expect(result).toMatchObject({
      ok: true,
      page: 2,
      perPage: 5,
      pullRequests: [{ authorLogin: null }],
    });
  });
});
