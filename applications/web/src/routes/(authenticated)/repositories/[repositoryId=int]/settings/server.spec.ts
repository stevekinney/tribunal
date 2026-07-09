import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetRepositoryById,
  mockUserCanAccessRepository,
  mockGetRepositoryOperatorDetails,
  mockListAgents,
  mockSaveRepositoryWatchSettings,
} = vi.hoisted(() => ({
  mockGetRepositoryById: vi.fn(),
  mockUserCanAccessRepository: vi.fn(),
  mockGetRepositoryOperatorDetails: vi.fn(() => Promise.resolve(new Map())),
  mockListAgents: vi.fn<() => Promise<Array<{ id: string; slug: string; enabled: boolean }>>>(() =>
    Promise.resolve([]),
  ),
  mockSaveRepositoryWatchSettings: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('@sveltejs/kit', () => ({
  error: (status: number, message: string) => {
    throw { status, body: { message }, type: 'error' };
  },
  fail: (status: number, data: unknown) => ({ status, data }),
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$lib/server/github-context', () => ({
  githubContext: {},
}));

vi.mock('@tribunal/github/repositories/service', () => ({
  getRepositoryById: mockGetRepositoryById,
}));

vi.mock('$lib/server/repositories', () => ({
  userCanAccessRepository: mockUserCanAccessRepository,
}));

vi.mock('$lib/server/review/operator', () => ({
  getRepositoryOperatorDetails: mockGetRepositoryOperatorDetails,
  listAgents: mockListAgents,
  saveRepositoryWatchSettings: mockSaveRepositoryWatchSettings,
}));

import { actions, load } from './+page.server';

const repository = { id: 101, owner: 'test-org', name: 'review-target' };

describe('/repositories/[repositoryId]/settings server load', () => {
  beforeEach(() => {
    mockGetRepositoryById.mockReset();
    mockGetRepositoryById.mockResolvedValue(repository);
    mockUserCanAccessRepository.mockReset();
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockGetRepositoryOperatorDetails.mockReset();
    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map());
    mockListAgents.mockReset();
    mockListAgents.mockResolvedValue([]);
    mockSaveRepositoryWatchSettings.mockReset();
    mockSaveRepositoryWatchSettings.mockResolvedValue({ success: true });
  });

  function createLoadEvent() {
    return {
      params: { repositoryId: '101' },
      locals: { user: { id: 1, username: 'test-user' } },
    } as Parameters<typeof load>[0];
  }

  it('returns 404 when the repository does not exist', async () => {
    mockGetRepositoryById.mockResolvedValue(null);

    await expect(load(createLoadEvent())).rejects.toMatchObject({ status: 404 });
  });

  it('returns 404 when the user cannot access the repository', async () => {
    mockUserCanAccessRepository.mockResolvedValue(false);

    await expect(load(createLoadEvent())).rejects.toMatchObject({ status: 404 });
  });

  it('returns the repository identity, review settings, and agents', async () => {
    mockGetRepositoryOperatorDetails.mockResolvedValue(
      new Map([
        [
          101,
          {
            hasSavedSettings: true,
            watched: true,
            ignoreGlobs: ['dist/**'],
            agents: [{ id: 'agent_1', slug: 'security', enabled: true }],
            lastRunStatus: null,
            estimatedCostLast30DaysUsd: 0,
          },
        ],
      ]),
    );
    mockListAgents.mockResolvedValue([
      { id: 'agent_1', slug: 'security', enabled: true },
      { id: 'agent_2', slug: 'documentation', enabled: false },
    ]);

    const result = await load(createLoadEvent());

    expect(result).toMatchObject({
      repository: {
        id: 101,
        owner: 'test-org',
        name: 'review-target',
        review: {
          ignoreGlobs: ['dist/**'],
          agents: [{ id: 'agent_1', slug: 'security', enabled: true }],
        },
      },
      agents: [
        { id: 'agent_1', slug: 'security', enabled: true },
        { id: 'agent_2', slug: 'documentation', enabled: false },
      ],
    });
  });

  it('defaults review settings when the repository has never been saved', async () => {
    const result = await load(createLoadEvent());

    expect(result).toMatchObject({
      repository: {
        review: {
          hasSavedSettings: false,
          watched: false,
          ignoreGlobs: [],
          agents: [],
        },
      },
    });
  });
});

describe('/repositories/[repositoryId]/settings server action', () => {
  beforeEach(() => {
    mockUserCanAccessRepository.mockReset();
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockSaveRepositoryWatchSettings.mockReset();
    mockSaveRepositoryWatchSettings.mockResolvedValue({ success: true });
  });

  function createActionEvent(formData: FormData) {
    return {
      params: { repositoryId: '101' },
      locals: { user: { id: 1, username: 'test-user' } },
      request: { formData: () => Promise.resolve(formData) },
    } as unknown as Parameters<(typeof actions)['default']>[0];
  }

  it('trims, rejects empty, and dedupes submitted ignore globs', async () => {
    const formData = new FormData();
    formData.append('ignoreGlobs', '  dist/** ');
    formData.append('ignoreGlobs', 'dist/**');
    formData.append('ignoreGlobs', '   ');
    formData.append('ignoreGlobs', 'coverage/**');
    formData.append('agentIds', 'agent_1');

    await actions.default(createActionEvent(formData));

    expect(mockSaveRepositoryWatchSettings).toHaveBeenCalledWith(1, {
      repositoryId: 101,
      watched: true,
      ignoreGlobs: ['dist/**', 'coverage/**'],
      agentIds: ['agent_1'],
    });
  });

  it('returns 404 when the user cannot access the repository', async () => {
    mockUserCanAccessRepository.mockResolvedValue(false);

    await expect(actions.default(createActionEvent(new FormData()))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects an invalid repository id', async () => {
    const event = {
      params: { repositoryId: 'not-a-number' },
      locals: { user: { id: 1, username: 'test-user' } },
      request: { formData: () => Promise.resolve(new FormData()) },
    } as unknown as Parameters<(typeof actions)['default']>[0];

    const result = await actions.default(event);

    expect(result).toMatchObject({ status: 400, data: { error: 'Repository is invalid.' } });
  });
});
