import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRepositoriesResult,
  mockGetRepositoryOperatorDetails,
  mockListAgents,
  mockSaveRepositoryWatchSettings,
} = vi.hoisted(() => ({
  mockRepositoriesResult: {
    value: {
      ok: true,
      repositories: [],
      installations: [],
    } as
      | {
          ok: true;
          repositories: [];
          installations: [];
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
