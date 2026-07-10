import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetRepositoryById,
  mockGetInstallationForRepository,
  mockUserCanAccessRepository,
  mockListPullRequests,
  mockParsePullRequestFilters,
  mockGetPullRequestOperationalStatus,
  mockGetRepositoryOperatorDetails,
  mockListAgents,
  mockDbSelect,
  mockEnv,
} = vi.hoisted(() => ({
  mockGetRepositoryById: vi.fn(),
  mockGetInstallationForRepository: vi.fn(),
  mockUserCanAccessRepository: vi.fn(),
  mockListPullRequests: vi.fn(),
  mockParsePullRequestFilters: vi.fn(),
  mockGetPullRequestOperationalStatus: vi.fn(),
  mockGetRepositoryOperatorDetails: vi.fn(),
  mockListAgents: vi.fn(),
  mockDbSelect: vi.fn(),
  mockEnv: {
    NODE_ENV: 'test' as string,
    E2E_TEST_MODE: '' as string,
    E2E_TEST_SECRET: '' as string,
  },
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
  error: (status: number, message: string) => {
    throw { status, body: { message }, type: 'error' };
  },
}));

vi.mock('@tribunal/github/repositories/service', () => ({
  getRepositoryById: mockGetRepositoryById,
  getInstallationForRepository: mockGetInstallationForRepository,
}));

vi.mock('@tribunal/github/pull-requests/service', () => ({
  listPullRequests: mockListPullRequests,
  parsePullRequestFilters: mockParsePullRequestFilters,
  getPullRequestOperationalStatus: mockGetPullRequestOperationalStatus,
}));

vi.mock('$lib/server/github-context', () => ({
  githubContext: {},
}));

vi.mock('$lib/server/repositories', () => ({
  userCanAccessRepository: mockUserCanAccessRepository,
}));

vi.mock('$lib/server/review/operator', () => ({
  getRepositoryOperatorDetails: mockGetRepositoryOperatorDetails,
  listAgents: mockListAgents,
}));

vi.mock('$lib/server/database', () => ({
  db: { select: mockDbSelect },
}));

vi.mock('$env/dynamic/private', () => ({
  get env() {
    return mockEnv;
  },
}));

import { load } from './+page.server';

const defaultFilters = {
  state: 'open' as const,
  sort: 'updated' as const,
  direction: 'desc' as const,
  page: 1,
  perPage: 30,
};

function runLoad(url = 'https://example.com/repositories/1/pull-requests') {
  return load({
    params: { repositoryId: '1' },
    locals: { user: { id: 1 } },
    url: new URL(url),
  } as never);
}

describe('repository pull requests page load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.NODE_ENV = 'test';
    mockEnv.E2E_TEST_MODE = '';
    mockEnv.E2E_TEST_SECRET = '';
    mockParsePullRequestFilters.mockReturnValue(defaultFilters);
    mockGetPullRequestOperationalStatus.mockResolvedValue({
      ciStatus: 'unknown',
      checkCount: 0,
      resolvedReviewThreadCount: null,
      unresolvedReviewThreadCount: null,
      mergeConflictStatus: 'unknown',
      mergeableState: null,
    });
    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map());
    mockListAgents.mockResolvedValue([]);
  });

  it('redirects to /login when the user is not authenticated', async () => {
    expect.assertions(1);
    await expect(
      load({
        params: { repositoryId: '1' },
        locals: {},
        url: new URL('https://example.com'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/login' });
  });

  it('returns 404 when the repository does not exist', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue(null);

    await expect(runLoad()).rejects.toMatchObject({ status: 404 });
  });

  it('returns 404 when the user cannot access the repository', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(false);

    await expect(runLoad()).rejects.toMatchObject({ status: 404 });
  });

  it('returns 502 when GitHub cannot be reached for the repository', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockGetInstallationForRepository.mockResolvedValue({ ok: false, error: 'not_found' });

    await expect(runLoad()).rejects.toMatchObject({ status: 502 });
  });

  it('parses filters from the request URL', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockGetInstallationForRepository.mockResolvedValue({
      ok: true,
      octokit: {},
      owner: 'acme',
      repo: 'widgets',
    });
    mockListPullRequests.mockResolvedValue({
      pullRequests: [],
      filters: defaultFilters,
      hasNextPage: false,
    });

    await runLoad('https://example.com/repositories/1/pull-requests?pr_state=closed');

    expect(mockParsePullRequestFilters).toHaveBeenCalledWith(
      new URL('https://example.com/repositories/1/pull-requests?pr_state=closed'),
    );
  });

  it('forwards installation owner, repo, filters, and repository id to listPullRequests', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    const octokit = { rest: {} };
    mockGetInstallationForRepository.mockResolvedValue({
      ok: true,
      octokit,
      owner: 'acme',
      repo: 'widgets',
    });
    mockListPullRequests.mockResolvedValue({
      pullRequests: [],
      filters: defaultFilters,
      hasNextPage: false,
    });

    await runLoad();

    expect(mockListPullRequests).toHaveBeenCalledWith(
      {},
      octokit,
      'acme',
      'widgets',
      defaultFilters,
      1,
    );
  });

  it('returns rows, active filters, and pagination metadata', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockGetInstallationForRepository.mockResolvedValue({
      ok: true,
      octokit: {},
      owner: 'acme',
      repo: 'widgets',
    });
    mockListPullRequests.mockResolvedValue({
      pullRequests: [
        {
          number: 1,
          title: 'Add feature',
          state: 'closed',
          draft: false,
          mergedAt: '2024-01-17T00:00:00Z',
          htmlUrl: 'https://github.com/acme/widgets/pull/1',
          headRef: 'feature',
          headSha: 'sha1',
          baseRef: 'main',
          updatedAt: '2024-01-16T12:00:00Z',
          author: { login: 'octocat', htmlUrl: 'https://github.com/octocat' },
        },
      ],
      filters: defaultFilters,
      hasNextPage: true,
    });

    await expect(runLoad()).resolves.toMatchObject({
      repository: { id: 1, owner: 'acme', name: 'widgets' },
      pullRequests: [
        {
          number: 1,
          title: 'Add feature',
          state: 'closed',
          mergedAt: '2024-01-17T00:00:00Z',
        },
      ],
      filters: defaultFilters,
      hasNextPage: true,
    });
  });

  it('only looks up operational status for pull requests on the current page', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockGetInstallationForRepository.mockResolvedValue({
      ok: true,
      octokit: {},
      owner: 'acme',
      repo: 'widgets',
    });
    const pageRows = [1, 2, 3].map((number) => ({
      number,
      title: `PR ${number}`,
      draft: false,
      htmlUrl: `https://github.com/acme/widgets/pull/${number}`,
      headRef: 'feature',
      headSha: `sha${number}`,
      baseRef: 'main',
      updatedAt: '2024-01-16T12:00:00Z',
      author: null,
    }));
    mockListPullRequests.mockResolvedValue({
      pullRequests: pageRows,
      filters: defaultFilters,
      hasNextPage: true,
    });

    await runLoad();

    expect(mockGetPullRequestOperationalStatus).toHaveBeenCalledTimes(3);
  });
});

describe('repository pull requests page load (E2E test mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.NODE_ENV = 'test';
    mockEnv.E2E_TEST_MODE = '1';
    mockEnv.E2E_TEST_SECRET = 'secret';
    mockParsePullRequestFilters.mockReturnValue(defaultFilters);
  });

  it('synthesizes pull requests from review_run rows when E2E test mode is enabled', async () => {
    expect.assertions(5);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockDbSelect.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () =>
              Promise.resolve([
                {
                  run: {
                    status: 'posted',
                    startedAt: new Date('2024-01-01T00:00:00Z'),
                    finishedAt: new Date('2024-01-02T00:00:00Z'),
                  },
                  review: { prNumber: 7, headSha: 'abc123' },
                },
              ]),
          }),
        }),
      }),
    });

    const result = (await runLoad()) as {
      pullRequests: Array<{ number: number; headRef: string; headSha: string }>;
      hasNextPage: boolean;
    };

    expect(result.pullRequests).toHaveLength(1);
    expect(result.pullRequests[0].number).toBe(7);
    expect(result.hasNextPage).toBe(false);
    // headRef must be a branch-like placeholder distinct from headSha, so
    // the UI doesn't show a commit SHA where it expects a branch name.
    expect(result.pullRequests[0].headRef).not.toBe(result.pullRequests[0].headSha);
    expect(result.pullRequests[0].headSha).toBe('abc123');
  });

  it('does not call GitHub when E2E test mode is enabled', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockDbSelect.mockReturnValue({
      from: () => ({
        innerJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }),
      }),
    });

    await runLoad();

    expect(mockGetInstallationForRepository).not.toHaveBeenCalled();
  });

  it('paginates and filters synthesized E2E pull requests', async () => {
    expect.assertions(2);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockParsePullRequestFilters.mockReturnValue({ ...defaultFilters, page: 1, perPage: 1 });
    mockDbSelect.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () =>
              Promise.resolve([
                {
                  run: {
                    status: 'posted',
                    startedAt: new Date('2024-01-02T00:00:00Z'),
                    finishedAt: new Date('2024-01-02T00:00:00Z'),
                  },
                  review: { prNumber: 2, headSha: 'sha2' },
                },
                {
                  run: {
                    status: 'posted',
                    startedAt: new Date('2024-01-01T00:00:00Z'),
                    finishedAt: new Date('2024-01-01T00:00:00Z'),
                  },
                  review: { prNumber: 1, headSha: 'sha1' },
                },
              ]),
          }),
        }),
      }),
    });

    const result = (await runLoad(
      'https://example.com/repositories/1/pull-requests?pr_per_page=1',
    )) as {
      pullRequests: Array<{ number: number }>;
      hasNextPage: boolean;
    };

    expect(result.pullRequests).toHaveLength(1);
    expect(result.hasNextPage).toBe(true);
  });

  it('returns no synthesized pull requests when the closed state filter is applied', async () => {
    expect.assertions(1);
    mockGetRepositoryById.mockResolvedValue({ id: 1, owner: 'acme', name: 'widgets' });
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockParsePullRequestFilters.mockReturnValue({ ...defaultFilters, state: 'closed' });
    mockDbSelect.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () =>
              Promise.resolve([
                {
                  run: {
                    status: 'posted',
                    startedAt: new Date('2024-01-01T00:00:00Z'),
                    finishedAt: new Date('2024-01-01T00:00:00Z'),
                  },
                  review: { prNumber: 1, headSha: 'sha1' },
                },
              ]),
          }),
        }),
      }),
    });

    const result = (await runLoad(
      'https://example.com/repositories/1/pull-requests?pr_state=closed',
    )) as { pullRequests: Array<{ number: number }> };

    expect(result.pullRequests).toHaveLength(0);
  });
});
