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
});
