import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetRepositoriesForUser,
  mockGetRepositoryOperatorDetails,
  mockListAgents,
  mockSaveRepositoryWatchSettings,
  mockUserOwnsRepository,
} = vi.hoisted(() => ({
  mockGetRepositoriesForUser: vi.fn(),
  mockGetRepositoryOperatorDetails: vi.fn(),
  mockListAgents: vi.fn(),
  mockSaveRepositoryWatchSettings: vi.fn(),
  mockUserOwnsRepository: vi.fn(),
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

vi.mock('$lib/server/review/operator', () => ({
  getRepositoryOperatorDetails: mockGetRepositoryOperatorDetails,
  listAgents: mockListAgents,
  saveRepositoryWatchSettings: mockSaveRepositoryWatchSettings,
  userOwnsRepository: mockUserOwnsRepository,
}));

import { actions, load } from './+page.server';

// The load only reads locals.user; a minimal event is enough for these cases.
function runLoad() {
  return load({ locals: { user: { id: 1 } } } as never);
}

describe('onboarding load: connectReason discrimination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "disconnected" when the GitHub token is missing or revoked', async () => {
    mockGetRepositoriesForUser.mockResolvedValue({
      ok: false,
      error: 'no_github_token',
      message: 'x',
    });

    await expect(runLoad()).resolves.toMatchObject({
      connectReason: 'disconnected',
      repositories: [],
      installations: [],
    });
  });

  it('returns "unavailable" on a transient GitHub error', async () => {
    mockGetRepositoriesForUser.mockResolvedValue({
      ok: false,
      error: 'github_unavailable',
      message: 'x',
    });

    await expect(runLoad()).resolves.toMatchObject({ connectReason: 'unavailable' });
  });

  it('returns "no_installation" when connected but no app is installed', async () => {
    mockGetRepositoriesForUser.mockResolvedValue({ ok: true, repositories: [], installations: [] });

    await expect(runLoad()).resolves.toMatchObject({ connectReason: 'no_installation' });
  });

  it('returns the picker (connectReason null) when installations exist', async () => {
    mockGetRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [{ repository: { id: 7, owner: 'acme', name: 'web', defaultBranch: 'main' } }],
      installations: [{ installationId: 1, accountLogin: 'acme', accountAvatarUrl: null }],
    });
    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map([[7, { watched: true }]]));

    await expect(runLoad()).resolves.toMatchObject({
      connectReason: null,
      repositories: [{ id: 7, owner: 'acme', name: 'web', defaultBranch: 'main', watched: true }],
      installations: [{ installationId: 1, accountLogin: 'acme' }],
    });
  });
});

describe('onboarding watch action: default agent assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserOwnsRepository.mockResolvedValue(true);
    mockSaveRepositoryWatchSettings.mockResolvedValue({ success: true });
  });

  function runWatch(repositoryIds: string[]) {
    const formData = new FormData();
    for (const id of repositoryIds) formData.append('repositoryId', id);
    return actions.watch({
      locals: { user: { id: 1 } },
      request: { formData: async () => formData },
    } as never);
  }

  it('watches each repository with the user’s enabled agents only', async () => {
    // Two enabled, one disabled — onboarding must assign the enabled pair, never
    // an empty list (which would leave the repository watched but unreviewed).
    mockListAgents.mockResolvedValue([
      { id: 'a1', enabled: true },
      { id: 'a2', enabled: false },
      { id: 'a3', enabled: true },
    ]);

    await expect(runWatch(['7'])).rejects.toMatchObject({
      status: 303,
      location: '/repositories?onboarded=1',
    });

    expect(mockSaveRepositoryWatchSettings).toHaveBeenCalledWith(1, {
      repositoryId: 7,
      watched: true,
      ignoreGlobs: [],
      agentIds: ['a1', 'a3'],
    });
  });
});
