import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetRepositoriesForUser,
  mockGetRepositoryOperatorDetails,
  mockListAgents,
  mockBuildRepositoryDashboard,
  mockSaveRepositoryWatchSettings,
} = vi.hoisted(() => ({
  mockGetRepositoriesForUser: vi.fn(),
  mockGetRepositoryOperatorDetails: vi.fn(),
  mockListAgents: vi.fn(),
  mockBuildRepositoryDashboard: vi.fn(),
  mockSaveRepositoryWatchSettings: vi.fn(),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
  fail: (status: number, data: unknown) => ({ status, data, type: 'failure' }),
}));

vi.mock('$lib/server/repositories', () => ({
  getRepositoriesForUser: mockGetRepositoriesForUser,
}));

vi.mock('$lib/server/github-context', () => ({
  githubContext: {},
}));

vi.mock('@tribunal/github/dashboard/service', () => ({
  buildRepositoryDashboard: mockBuildRepositoryDashboard,
}));

vi.mock('$lib/server/review/operator', () => ({
  getRepositoryOperatorDetails: mockGetRepositoryOperatorDetails,
  listAgents: mockListAgents,
  operatorSurfaceStates: ['empty', 'loading', 'streaming', 'success', 'error', 'disconnected'],
  parseIgnoreGlobs: (value: string) => value.split('\n').filter(Boolean),
  saveRepositoryWatchSettings: mockSaveRepositoryWatchSettings,
}));

import { actions, load } from './+page.server';

function runLoad() {
  return load({
    locals: { user: { id: 1 } },
    url: new URL('http://localhost/repositories'),
  } as never);
}

function makeAccessibleRepository(id: number, owner: string, name: string) {
  return {
    repository: { id, owner, name, defaultBranch: 'main', commit: null },
    installation: { installationId: 999, accountLogin: owner, accountAvatarUrl: null },
  };
}

function watchedDetails() {
  return {
    hasSavedSettings: true,
    watched: true,
    ignoreGlobs: [],
    agents: [],
    lastRunStatus: null,
    estimatedCostLast30DaysUsd: 0,
  };
}

describe('/repositories load: added repositories only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAgents.mockResolvedValue([]);
    mockBuildRepositoryDashboard.mockResolvedValue([]);
  });

  it('builds the dashboard only for repositories the user has added (watched)', async () => {
    const unwatched = makeAccessibleRepository(1, 'test-org', 'a-repo');
    const watched = makeAccessibleRepository(2, 'test-org', 'z-repo');

    mockGetRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [unwatched, watched],
      installations: [{ installationId: 999, accountLogin: 'test-org', accountAvatarUrl: null }],
    });

    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map([[2, watchedDetails()]]));

    await runLoad();

    expect(mockBuildRepositoryDashboard).toHaveBeenCalledTimes(1);
    const [, dashboardInput] = mockBuildRepositoryDashboard.mock.calls[0] as [
      unknown,
      Array<{ id: number }>,
    ];
    // Only the added repository is fanned out to GitHub — the unwatched one is
    // never dashboard-built, no matter how large the accessible catalog is.
    expect(dashboardInput.map((entry) => entry.id)).toEqual([2]);
  });

  it('surfaces unwatched accessible repositories as addable, not in the table', async () => {
    const unwatched = makeAccessibleRepository(1, 'test-org', 'a-repo');
    const watched = makeAccessibleRepository(2, 'test-org', 'z-repo');

    mockGetRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [unwatched, watched],
      installations: [{ installationId: 999, accountLogin: 'test-org', accountAvatarUrl: null }],
    });

    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map([[2, watchedDetails()]]));

    const data = await runLoad();

    expect(data.repositories.map((repository: { id: number }) => repository.id)).toEqual([2]);
    expect(data.addableRepositories).toEqual([
      { id: 1, owner: 'test-org', name: 'a-repo', defaultBranch: 'main' },
    ]);
  });

  it('builds no dashboard and adds every accessible repository when nothing is watched', async () => {
    const first = makeAccessibleRepository(1, 'test-org', 'a-repo');
    const second = makeAccessibleRepository(2, 'test-org', 'b-repo');

    mockGetRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [first, second],
      installations: [{ installationId: 999, accountLogin: 'test-org', accountAvatarUrl: null }],
    });

    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map());

    const data = await runLoad();

    const [, dashboardInput] = mockBuildRepositoryDashboard.mock.calls[0] as [
      unknown,
      Array<{ id: number }>,
    ];
    expect(dashboardInput).toEqual([]);
    expect(data.repositories).toEqual([]);
    expect(data.addableRepositories.map((repository: { id: number }) => repository.id)).toEqual([
      1, 2,
    ]);
  });

  it('surfaces attention-needing pull requests sorted by most-recently updated', async () => {
    const watched = makeAccessibleRepository(2, 'test-org', 'z-repo');

    mockGetRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [watched],
      installations: [{ installationId: 999, accountLogin: 'test-org', accountAvatarUrl: null }],
    });
    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map([[2, watchedDetails()]]));
    mockBuildRepositoryDashboard.mockResolvedValue([
      {
        repository: { id: 2, owner: 'test-org', name: 'z-repo' },
        pullRequests: [
          {
            number: 1,
            updatedAt: '2026-01-01T00:00:00Z',
            ciStatus: 'passing',
            mergeStatus: 'clean',
            unresolvedThreadCount: 0,
          },
          {
            number: 2,
            updatedAt: '2026-01-02T00:00:00Z',
            ciStatus: 'failing',
            mergeStatus: 'clean',
            unresolvedThreadCount: 0,
          },
          {
            number: 3,
            updatedAt: '2026-01-03T00:00:00Z',
            ciStatus: 'passing',
            mergeStatus: 'clean',
            unresolvedThreadCount: 2,
          },
        ],
      },
    ]);

    const data = await runLoad();

    // PR #1 (passing/clean/no unresolved threads) never needs attention; #2
    // (failing CI) and #3 (unresolved threads) do, newest-updated first.
    expect(data.attentionPullRequests.map((pr: { number: number }) => pr.number)).toEqual([3, 2]);
    expect(data.attentionPullRequests[0]).toMatchObject({
      repositoryOwner: 'test-org',
      repositoryName: 'z-repo',
    });
  });
});

describe('/repositories load: connect prompts and errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAgents.mockResolvedValue([]);
    mockBuildRepositoryDashboard.mockResolvedValue([]);
  });

  it('redirects unauthenticated requests to login', async () => {
    await expect(
      load({ locals: {}, url: new URL('http://localhost/repositories') } as never),
    ).rejects.toMatchObject({ status: 302, location: '/login' });
  });

  it('redirects to connect a GitHub account when there is no usable token', async () => {
    mockGetRepositoriesForUser.mockResolvedValue({
      ok: false,
      error: 'no_github_token',
      message: 'x',
    });

    await expect(runLoad()).rejects.toMatchObject({
      status: 302,
      location: expect.stringContaining('/connect/github/account?returnTo='),
    });
  });

  it('renders a connect prompt instead of redirecting when a route error is already present', async () => {
    mockGetRepositoriesForUser.mockResolvedValue({
      ok: false,
      error: 'no_github_token',
      message: 'x',
    });

    const data = await load({
      locals: { user: { id: 1 } },
      url: new URL('http://localhost/repositories?error=github_denied'),
    } as never);

    expect(data).toMatchObject({ repositories: [], needsConnect: true });
    expect(data.loadError).toBeTruthy();
  });

  it('surfaces the transient-unavailable message without treating it as needing a connect', async () => {
    mockGetRepositoriesForUser.mockResolvedValue({
      ok: false,
      error: 'github_unavailable',
      message: 'GitHub is temporarily unavailable.',
    });

    const data = await runLoad();

    expect(data).toMatchObject({
      repositories: [],
      needsConnect: false,
      loadError: 'GitHub is temporarily unavailable.',
    });
  });
});

describe('/repositories actions.watch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createRequest(formEntries: Record<string, string | string[]>) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(formEntries)) {
      if (Array.isArray(value)) {
        for (const entry of value) formData.append(key, entry);
      } else {
        formData.set(key, value);
      }
    }
    return { formData: vi.fn().mockResolvedValue(formData) } as unknown as Request;
  }

  it('redirects to /login when no user is present', async () => {
    await expect(
      actions.watch({ locals: {}, request: createRequest({}) } as never),
    ).rejects.toMatchObject({ status: 302, location: '/login' });
  });

  it('rejects an invalid repository id', async () => {
    const result = await actions.watch({
      locals: { user: { id: 1 } },
      request: createRequest({ repositoryId: 'not-a-number' }),
    } as never);

    expect(result).toMatchObject({ status: 400, data: { error: 'Repository is invalid.' } });
  });

  it('saves watch settings using the submitted ignoreGlobs and agentIds', async () => {
    mockSaveRepositoryWatchSettings.mockResolvedValue({ success: true });

    const result = await actions.watch({
      locals: { user: { id: 1 } },
      request: createRequest({
        repositoryId: '2',
        watched: 'on',
        ignoreGlobs: 'docs/**',
        agentIds: ['agent_a', 'agent_b'],
      }),
    } as never);

    expect(mockSaveRepositoryWatchSettings).toHaveBeenCalledWith(1, {
      repositoryId: 2,
      watched: true,
      ignoreGlobs: ['docs/**'],
      agentIds: ['agent_a', 'agent_b'],
    });
    expect(result).toEqual({ success: true });
  });

  it('falls back to the previously saved ignoreGlobs/agentIds when the form omits them', async () => {
    mockSaveRepositoryWatchSettings.mockResolvedValue({ success: true });
    mockGetRepositoryOperatorDetails.mockResolvedValue(
      new Map([
        [
          2,
          {
            hasSavedSettings: true,
            watched: true,
            ignoreGlobs: ['saved/**'],
            agents: [{ id: 'agent_saved' }],
            lastRunStatus: null,
            estimatedCostLast30DaysUsd: 0,
          },
        ],
      ]),
    );

    await actions.watch({
      locals: { user: { id: 1 } },
      request: createRequest({ repositoryId: '2', watched: 'on' }),
    } as never);

    expect(mockSaveRepositoryWatchSettings).toHaveBeenCalledWith(1, {
      repositoryId: 2,
      watched: true,
      ignoreGlobs: ['saved/**'],
      agentIds: ['agent_saved'],
    });
  });

  it('defaults to every enabled agent when the repository has no saved settings and the form omits agentIds', async () => {
    mockSaveRepositoryWatchSettings.mockResolvedValue({ success: true });
    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map());
    mockListAgents.mockResolvedValue([
      { id: 'agent_enabled', enabled: true },
      { id: 'agent_disabled', enabled: false },
    ]);

    await actions.watch({
      locals: { user: { id: 1 } },
      request: createRequest({ repositoryId: '2', watched: 'on' }),
    } as never);

    expect(mockSaveRepositoryWatchSettings).toHaveBeenCalledWith(1, {
      repositoryId: 2,
      watched: true,
      ignoreGlobs: [],
      agentIds: ['agent_enabled'],
    });
  });
});
