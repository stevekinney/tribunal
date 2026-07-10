import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUserCanAccessRepository,
  mockSubmitRepositorySettingsForm,
  mockGetRepositoryById,
  mockGetRepositoryOperatorDetails,
  mockListAgents,
  mockListPullRequests,
} = vi.hoisted(() => ({
  mockUserCanAccessRepository: vi.fn(),
  mockSubmitRepositorySettingsForm: vi.fn(() => Promise.resolve({ success: true })),
  mockGetRepositoryById: vi.fn(),
  mockGetRepositoryOperatorDetails: vi.fn(() => Promise.resolve(new Map())),
  mockListAgents: vi.fn<() => Promise<Array<{ id: string; slug: string; enabled: boolean }>>>(() =>
    Promise.resolve([]),
  ),
  mockListPullRequests: vi.fn(() => Promise.resolve({ pullRequests: [] })),
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

vi.mock('$env/dynamic/private', () => ({ env: {} }));

vi.mock('$lib/server/database', () => ({ db: {} }));

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('@tribunal/github/repositories/service', () => ({
  getRepositoryById: mockGetRepositoryById,
  getInstallationForRepository: vi.fn(() =>
    Promise.resolve({ ok: true, octokit: {}, owner: 'test-org', repo: 'review-target' }),
  ),
}));

vi.mock('@tribunal/github/pull-requests/service', () => ({
  getPullRequestOperationalStatus: vi.fn(),
  listPullRequests: mockListPullRequests,
}));

vi.mock('$lib/server/repositories', () => ({
  userCanAccessRepository: mockUserCanAccessRepository,
}));

vi.mock('$lib/server/review/operator', () => ({
  getRepositoryOperatorDetails: mockGetRepositoryOperatorDetails,
  listAgents: mockListAgents,
  submitRepositorySettingsForm: mockSubmitRepositorySettingsForm,
}));

import { actions, load } from './+page.server';

describe('/repositories/[repositoryId]/pull-requests legacy saveSettings action', () => {
  beforeEach(() => {
    mockUserCanAccessRepository.mockReset();
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockSubmitRepositorySettingsForm.mockReset();
    mockSubmitRepositorySettingsForm.mockResolvedValue({ success: true });
  });

  function createActionEvent(formData: FormData) {
    return {
      params: { repositoryId: '101' },
      locals: { user: { id: 1, username: 'test-user' } },
      request: { formData: () => Promise.resolve(formData) },
    } as unknown as Parameters<(typeof actions)['saveSettings']>[0];
  }

  it('still saves settings submitted to the old ?/saveSettings action', async () => {
    const formData = new FormData();
    formData.append('ignoreGlobs', 'dist/**');
    formData.append('agentIds', 'agent_1');

    const result = await actions.saveSettings(createActionEvent(formData));

    expect(mockSubmitRepositorySettingsForm).toHaveBeenCalledWith(1, 101, formData);
    expect(result).toEqual({ success: true });
  });

  it('returns 404 when the user cannot access the repository', async () => {
    mockUserCanAccessRepository.mockResolvedValue(false);

    await expect(actions.saveSettings(createActionEvent(new FormData()))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects an invalid repository id', async () => {
    const event = {
      params: { repositoryId: 'not-a-number' },
      locals: { user: { id: 1, username: 'test-user' } },
      request: { formData: () => Promise.resolve(new FormData()) },
    } as unknown as Parameters<(typeof actions)['saveSettings']>[0];

    const result = await actions.saveSettings(event);

    expect(result).toMatchObject({ status: 400, data: { error: 'Repository is invalid.' } });
  });
});

describe('/repositories/[repositoryId]/pull-requests legacy load data shape', () => {
  const repository = { id: 101, owner: 'test-org', name: 'review-target' };

  beforeEach(() => {
    mockUserCanAccessRepository.mockReset();
    mockUserCanAccessRepository.mockResolvedValue(true);
    mockGetRepositoryById.mockReset();
    mockGetRepositoryById.mockResolvedValue(repository);
    mockGetRepositoryOperatorDetails.mockReset();
    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map());
    mockListAgents.mockReset();
    mockListAgents.mockResolvedValue([]);
    mockListPullRequests.mockReset();
    mockListPullRequests.mockResolvedValue({ pullRequests: [] });
  });

  function createLoadEvent() {
    return {
      params: { repositoryId: '101' },
      locals: { user: { id: 1, username: 'test-user' } },
    } as Parameters<typeof load>[0];
  }

  it('still returns repository.review and agents for a stale pre-move client', async () => {
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
    mockListAgents.mockResolvedValue([{ id: 'agent_1', slug: 'security', enabled: true }]);

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
      agents: [{ id: 'agent_1', slug: 'security', enabled: true }],
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
