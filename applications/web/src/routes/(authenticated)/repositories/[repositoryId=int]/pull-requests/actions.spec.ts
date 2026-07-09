import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUserCanAccessRepository, mockSubmitRepositorySettingsForm } = vi.hoisted(() => ({
  mockUserCanAccessRepository: vi.fn(),
  mockSubmitRepositorySettingsForm: vi.fn(() => Promise.resolve({ success: true })),
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
  getRepositoryById: vi.fn(),
  getInstallationForRepository: vi.fn(),
}));

vi.mock('@tribunal/github/pull-requests/service', () => ({
  getPullRequestOperationalStatus: vi.fn(),
  listPullRequests: vi.fn(),
}));

vi.mock('$lib/server/repositories', () => ({
  userCanAccessRepository: mockUserCanAccessRepository,
}));

vi.mock('$lib/server/review/operator', () => ({
  submitRepositorySettingsForm: mockSubmitRepositorySettingsForm,
}));

import { actions } from './+page.server';

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
