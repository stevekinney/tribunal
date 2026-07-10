import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetRepositoriesForUser,
  mockGetRepositoryOperatorDetails,
  mockListAgents,
  mockBuildRepositoryDashboard,
} = vi.hoisted(() => ({
  mockGetRepositoriesForUser: vi.fn(),
  mockGetRepositoryOperatorDetails: vi.fn(),
  mockListAgents: vi.fn(),
  mockBuildRepositoryDashboard: vi.fn(),
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
  saveRepositoryWatchSettings: vi.fn(),
}));

import { load } from './+page.server';

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

describe('/repositories load: dashboard budget ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAgents.mockResolvedValue([]);
    mockBuildRepositoryDashboard.mockResolvedValue([]);
  });

  it('passes watched repositories to buildRepositoryDashboard ahead of unwatched ones', async () => {
    // Alphabetically (and thus in the accessible-repository list order) "a-repo"
    // sorts before "z-repo", but only "z-repo" is watched.
    const unwatched = makeAccessibleRepository(1, 'test-org', 'a-repo');
    const watched = makeAccessibleRepository(2, 'test-org', 'z-repo');

    mockGetRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [unwatched, watched],
      installations: [{ installationId: 999, accountLogin: 'test-org', accountAvatarUrl: null }],
    });

    mockGetRepositoryOperatorDetails.mockResolvedValue(
      new Map([
        [
          2,
          {
            hasSavedSettings: true,
            watched: true,
            ignoreGlobs: [],
            agents: [],
            lastRunStatus: null,
            estimatedCostLast30DaysUsd: 0,
          },
        ],
      ]),
    );

    await runLoad();

    expect(mockBuildRepositoryDashboard).toHaveBeenCalledTimes(1);
    const [, dashboardInput] = mockBuildRepositoryDashboard.mock.calls[0] as [
      unknown,
      Array<{ id: number }>,
    ];
    expect(dashboardInput.map((entry) => entry.id)).toEqual([2, 1]);
  });

  it('keeps unwatched repositories in their original relative order among themselves', async () => {
    const first = makeAccessibleRepository(1, 'test-org', 'a-repo');
    const second = makeAccessibleRepository(2, 'test-org', 'b-repo');

    mockGetRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [first, second],
      installations: [{ installationId: 999, accountLogin: 'test-org', accountAvatarUrl: null }],
    });

    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map());

    await runLoad();

    const [, dashboardInput] = mockBuildRepositoryDashboard.mock.calls[0] as [
      unknown,
      Array<{ id: number }>,
    ];
    expect(dashboardInput.map((entry) => entry.id)).toEqual([1, 2]);
  });
});
