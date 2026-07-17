import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryDashboardRow } from '@tribunal/github/dashboard/types';

const {
  mockRepositoriesResult,
  mockGetRepositoryOperatorDetails,
  mockListAgents,
  mockSaveRepositoryWatchSettings,
  mockBuildRepositoryDashboard,
} = vi.hoisted(() => ({
  mockRepositoriesResult: {
    value: {
      ok: true,
      repositories: [],
      installations: [],
    } as
      | {
          ok: true;
          repositories: Array<{
            repository: {
              id: number;
              owner: string;
              name: string;
              defaultBranch: string | null;
              commit: string | null;
            };
            installation: {
              installationId: number;
              accountLogin: string;
              accountAvatarUrl: string | null;
            };
          }>;
          installations: Array<{
            installationId: number;
            accountLogin: string;
            accountAvatarUrl: string | null;
          }>;
        }
      | {
          ok: false;
          error: 'no_github_token' | 'github_unavailable';
          message: string;
        },
  },
  mockGetRepositoryOperatorDetails: vi.fn(() => Promise.resolve(new Map())),
  mockListAgents: vi.fn<() => Promise<Array<{ id: string; enabled: boolean }>>>(() =>
    Promise.resolve([]),
  ),
  mockSaveRepositoryWatchSettings: vi.fn(() => Promise.resolve({ success: true })),
  mockBuildRepositoryDashboard: vi.fn<() => Promise<RepositoryDashboardRow[]>>(() =>
    Promise.resolve([]),
  ),
}));

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data: unknown) => ({ status, data }),
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$lib/server/repositories', () => ({
  getRepositoriesForUser: vi.fn(() => Promise.resolve(mockRepositoriesResult.value)),
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
  parseIgnoreGlobs: (input: string) =>
    input
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  saveRepositoryWatchSettings: mockSaveRepositoryWatchSettings,
}));

import { actions, load } from './+page.server';

type RepositoriesLoadResult = {
  needsConnect: boolean;
  loadError: string | null;
  repositories: Array<{ id: number; review: { watched: boolean } }>;
  summary: {
    totalRepositoryCount: number;
    failingDefaultBranchCount: number;
    failingDefaultBranchCountExact: boolean;
    openPullRequestCount: number;
    openPullRequestCountExact: boolean;
    attentionPullRequestCount: number;
    attentionPullRequestCountExact: boolean;
    hasUnavailableRepositories: boolean;
  } | null;
};

describe('/repositories server load', () => {
  beforeEach(() => {
    mockRepositoriesResult.value = {
      ok: true,
      repositories: [],
      installations: [],
    };
    mockGetRepositoryOperatorDetails.mockReset();
    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map());
    mockListAgents.mockReset();
    mockListAgents.mockResolvedValue([]);
    mockSaveRepositoryWatchSettings.mockReset();
    mockSaveRepositoryWatchSettings.mockResolvedValue({ success: true });
    mockBuildRepositoryDashboard.mockReset();
    mockBuildRepositoryDashboard.mockResolvedValue([]);
  });

  function createEvent(search = '') {
    return {
      url: new URL(`http://localhost/repositories${search}`),
      locals: {
        user: {
          id: 1,
          username: 'test-user',
        },
      },
    } as Parameters<typeof load>[0];
  }

  it('surfaces GitHub OAuth configuration errors from the query string', async () => {
    const result = (await load(
      createEvent('?error=github_oauth_not_configured'),
    )) as RepositoriesLoadResult;

    expect(result.loadError).toBe(
      'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, then restart the development server.',
    );
    expect.assertions(1);
  });

  it('keeps query-string errors visible even when repository resolution also needs reconnect', async () => {
    mockRepositoriesResult.value = {
      ok: false,
      error: 'no_github_token',
      message: 'Reconnect GitHub.',
    };

    const result = (await load(
      createEvent('?error=github_redirect_uri_not_configured'),
    )) as RepositoriesLoadResult;

    expect(result.needsConnect).toBe(true);
    expect(result.loadError).toBe(
      'GitHub OAuth redirect URI is not configured. Set GITHUB_REDIRECT_URI outside local development.',
    );
    expect.assertions(2);
  });

  it('redirects missing GitHub OAuth connections into the account connection flow', async () => {
    mockRepositoriesResult.value = {
      ok: false,
      error: 'no_github_token',
      message: 'Reconnect GitHub.',
    };

    await expect(load(createEvent())).rejects.toMatchObject({
      status: 302,
      location: '/connect/github/account?returnTo=%2Frepositories',
    });
    expect.assertions(1);
  });

  it('builds dashboard rows only for added repositories and lists the rest as addable', async () => {
    mockRepositoriesResult.value = {
      ok: true,
      repositories: [
        {
          repository: {
            id: 101,
            owner: 'acme',
            name: 'widgets',
            defaultBranch: 'main',
            commit: 'sha1',
          },
          installation: { installationId: 1, accountLogin: 'acme', accountAvatarUrl: null },
        },
        {
          repository: {
            id: 202,
            owner: 'acme',
            name: 'gadgets',
            defaultBranch: 'main',
            commit: 'sha2',
          },
          installation: { installationId: 1, accountLogin: 'acme', accountAvatarUrl: null },
        },
      ],
      installations: [{ installationId: 1, accountLogin: 'acme', accountAvatarUrl: null }],
    };
    // Only repository 101 has a saved "watched" setting; 202 is accessible but not yet added.
    mockGetRepositoryOperatorDetails.mockResolvedValue(
      new Map([
        [
          101,
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
    // Only the added repository (101) is passed to the dashboard build, so the
    // build only ever returns a row for it — 202 never triggers a GitHub fetch.
    mockBuildRepositoryDashboard.mockResolvedValue([
      {
        repository: { id: 101, owner: 'acme', name: 'widgets', defaultBranch: 'main' },
        defaultBranchStatus: 'failing',
        openPullRequestCount: 3,
        openPullRequestCountAtCap: false,
        attentionPullRequestCount: 1,
        unresolvedThreadCount: 2,
        pullRequests: [
          {
            repositoryId: 101,
            number: 7,
            title: 'Broken build',
            htmlUrl: 'https://github.com/acme/widgets/pull/7',
            author: null,
            draft: false,
            headRef: 'fix',
            baseRef: 'main',
            headSha: 'sha-head',
            ciStatus: 'failing',
            ciUpdatedAt: '2026-07-09T00:00:00.000Z',
            mergeStatus: 'clean',
            mergeUpdatedAt: '2026-07-09T00:00:00.000Z',
            unresolvedThreadCount: 2,
            reviewUpdatedAt: '2026-07-09T00:00:00.000Z',
            updatedAt: '2026-07-09T00:00:00.000Z',
          },
        ],
        refreshedAt: '2026-07-09T00:00:00.000Z',
        dataStatus: 'ok',
      },
    ]);

    const result = (await load(createEvent())) as unknown as {
      repositories: Array<{
        id: number;
        review: { watched: boolean };
        dashboard: { defaultBranchStatus: string } | null;
      }>;
      addableRepositories: Array<{ id: number; owner: string; name: string }>;
      summary: RepositoriesLoadResult['summary'];
      attentionPullRequests: Array<{ number: number; repositoryOwner: string }>;
    };

    // Only the added repository is dashboard-built; the build receives only its id.
    const [, dashboardInput] = mockBuildRepositoryDashboard.mock.calls[0] as [
      unknown,
      Array<{ id: number }>,
    ];
    expect(dashboardInput.map((entry) => entry.id)).toEqual([101]);

    // The table lists only the added repository; the accessible-but-unadded one
    // is surfaced through the "Add repository" picker instead.
    expect(result.repositories.map((r) => r.id)).toEqual([101]);
    expect(result.repositories.find((r) => r.id === 101)?.review.watched).toBe(true);
    expect(result.repositories.find((r) => r.id === 101)?.dashboard?.defaultBranchStatus).toBe(
      'failing',
    );
    expect(result.addableRepositories).toEqual([
      { id: 202, owner: 'acme', name: 'gadgets', defaultBranch: 'main' },
    ]);

    expect(result.summary).toEqual({
      totalRepositoryCount: 1,
      failingDefaultBranchCount: 1,
      failingDefaultBranchCountExact: true,
      openPullRequestCount: 3,
      openPullRequestCountExact: true,
      attentionPullRequestCount: 1,
      attentionPullRequestCountExact: true,
      hasUnavailableRepositories: false,
    });

    expect(result.attentionPullRequests).toHaveLength(1);
    expect(result.attentionPullRequests[0]).toMatchObject({
      number: 7,
      repositoryOwner: 'acme',
    });
  });

  it('does not expose repositories the user cannot access', async () => {
    mockRepositoriesResult.value = {
      ok: true,
      repositories: [
        {
          repository: {
            id: 101,
            owner: 'acme',
            name: 'widgets',
            defaultBranch: 'main',
            commit: 'sha1',
          },
          installation: { installationId: 1, accountLogin: 'acme', accountAvatarUrl: null },
        },
      ],
      installations: [{ installationId: 1, accountLogin: 'acme', accountAvatarUrl: null }],
    };
    mockGetRepositoryOperatorDetails.mockResolvedValue(
      new Map([
        [
          101,
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
    mockBuildRepositoryDashboard.mockResolvedValue([
      {
        repository: { id: 101, owner: 'acme', name: 'widgets', defaultBranch: 'main' },
        defaultBranchStatus: 'passing',
        openPullRequestCount: 0,
        openPullRequestCountAtCap: false,
        attentionPullRequestCount: 0,
        unresolvedThreadCount: 0,
        pullRequests: [],
        refreshedAt: '2026-07-09T00:00:00.000Z',
        dataStatus: 'ok',
      },
    ]);

    const result = (await load(createEvent())) as unknown as {
      repositories: Array<{ id: number }>;
    };

    // getRepositoriesForUser is the sole authorization boundary here (mocked to
    // return only repository 101); the route must not add anything beyond it.
    expect(result.repositories.map((r) => r.id)).toEqual([101]);
  });
});

describe('/repositories watch action', () => {
  beforeEach(() => {
    mockGetRepositoryOperatorDetails.mockReset();
    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map());
    mockListAgents.mockReset();
    mockListAgents.mockResolvedValue([]);
    mockSaveRepositoryWatchSettings.mockReset();
    mockSaveRepositoryWatchSettings.mockResolvedValue({ success: true });
  });

  function createActionEvent(formData: FormData) {
    return {
      request: new Request('http://localhost/repositories?/watch', {
        method: 'POST',
        body: formData,
      }),
      locals: {
        user: {
          id: 1,
          username: 'test-user',
        },
      },
    } as Parameters<(typeof actions)['watch']>[0];
  }

  it('preserves saved repository settings when re-adding from the add control', async () => {
    const formData = new FormData();
    formData.set('repositoryId', '123');
    formData.set('watched', 'on');
    mockGetRepositoryOperatorDetails.mockResolvedValue(
      new Map([
        [
          123,
          {
            hasSavedSettings: true,
            watched: false,
            ignoreGlobs: ['dist/**'],
            agents: [{ id: 'agent-a' }, { id: 'agent-b' }],
          },
        ],
      ]),
    );

    await actions.watch(createActionEvent(formData));

    expect(mockSaveRepositoryWatchSettings).toHaveBeenCalledWith(1, {
      repositoryId: 123,
      watched: true,
      ignoreGlobs: ['dist/**'],
      agentIds: ['agent-a', 'agent-b'],
    });
    expect(mockListAgents).not.toHaveBeenCalled();
    expect.assertions(2);
  });

  it('defaults first-time added repositories to enabled agents', async () => {
    const formData = new FormData();
    formData.set('repositoryId', '456');
    formData.set('watched', 'on');
    mockListAgents.mockResolvedValue([
      { id: 'enabled-agent', enabled: true },
      { id: 'disabled-agent', enabled: false },
    ]);

    await actions.watch(createActionEvent(formData));

    expect(mockSaveRepositoryWatchSettings).toHaveBeenCalledWith(1, {
      repositoryId: 456,
      watched: true,
      ignoreGlobs: [],
      agentIds: ['enabled-agent'],
    });
    expect.assertions(1);
  });
});
