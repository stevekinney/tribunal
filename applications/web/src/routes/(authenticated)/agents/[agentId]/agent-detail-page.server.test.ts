import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDeleteAgent,
  mockGetAgent,
  mockGetReviewEffortOptions,
  mockGetReviewModelOptions,
  mockGetUserReviewSettings,
  mockSaveAgent,
} = vi.hoisted(() => ({
  mockDeleteAgent: vi.fn(),
  mockGetAgent: vi.fn(),
  mockGetReviewEffortOptions: vi.fn(),
  mockGetReviewModelOptions: vi.fn(),
  mockGetUserReviewSettings: vi.fn(),
  mockSaveAgent: vi.fn(),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
  error: (status: number, message: string) => {
    throw { status, message, type: 'error' };
  },
}));

vi.mock('$lib/server/review/operator', () => ({
  deleteAgent: mockDeleteAgent,
  getAgent: mockGetAgent,
  getReviewEffortOptions: mockGetReviewEffortOptions,
  getReviewModelOptions: mockGetReviewModelOptions,
  getUserReviewSettings: mockGetUserReviewSettings,
  saveAgent: mockSaveAgent,
}));

import { load, actions } from './+page.server';

describe('/agents/[agentId] load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReviewModelOptions.mockReturnValue(['inherit', 'sonnet']);
    mockGetReviewEffortOptions.mockReturnValue(['low', 'high']);
  });

  it('redirects to /login when no user is present', async () => {
    await expect(
      load({ locals: {}, params: { agentId: 'agent_1' } } as never),
    ).rejects.toMatchObject({ status: 302, location: '/login' });
  });

  it('errors with 404 when the agent does not exist', async () => {
    mockGetAgent.mockResolvedValue(undefined);
    mockGetUserReviewSettings.mockResolvedValue([{ defaultModel: 'sonnet' }]);

    await expect(
      load({ locals: { user: { id: 1 } }, params: { agentId: 'missing' } } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('resolves the inherited default model to sonnet', async () => {
    mockGetAgent.mockResolvedValue({ id: 'agent_1' });
    mockGetUserReviewSettings.mockResolvedValue([{ defaultModel: 'inherit' }]);

    const data = await load({
      locals: { user: { id: 1 } },
      params: { agentId: 'agent_1' },
    } as never);

    expect(data).toEqual({
      agent: { id: 'agent_1' },
      defaultModel: 'sonnet',
      modelOptions: ['inherit', 'sonnet'],
      effortOptions: ['low', 'high'],
    });
  });

  it('passes through a concrete default model unchanged', async () => {
    mockGetAgent.mockResolvedValue({ id: 'agent_1' });
    mockGetUserReviewSettings.mockResolvedValue([{ defaultModel: 'opus' }]);

    const data = (await load({
      locals: { user: { id: 1 } },
      params: { agentId: 'agent_1' },
    } as never)) as { defaultModel: string };

    expect(data.defaultModel).toBe('opus');
  });
});

describe('/agents/[agentId] actions.save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login when no user is present', async () => {
    const request = { formData: vi.fn() } as unknown as Request;
    await expect(actions.save({ locals: {}, request } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    });
  });

  it('delegates to saveAgent with the submitted form data', async () => {
    const formData = new FormData();
    const request = { formData: vi.fn().mockResolvedValue(formData) } as unknown as Request;
    mockSaveAgent.mockResolvedValue({ success: true });

    const result = await actions.save({ locals: { user: { id: 1 } }, request } as never);

    expect(mockSaveAgent).toHaveBeenCalledWith(1, formData);
    expect(result).toEqual({ success: true });
  });
});

describe('/agents/[agentId] actions.delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login when no user is present', async () => {
    const request = { formData: vi.fn() } as unknown as Request;
    await expect(actions.delete({ locals: {}, request } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    });
  });

  it('redirects to /agents after a successful delete', async () => {
    const request = { formData: vi.fn().mockResolvedValue(new FormData()) } as unknown as Request;
    mockDeleteAgent.mockResolvedValue({ success: true });

    await expect(
      actions.delete({ locals: { user: { id: 1 } }, request } as never),
    ).rejects.toMatchObject({ status: 303, location: '/agents' });
  });

  it('returns the failure result without redirecting when delete fails', async () => {
    const request = { formData: vi.fn().mockResolvedValue(new FormData()) } as unknown as Request;
    mockDeleteAgent.mockResolvedValue({ status: 404, data: { error: 'Agent not found.' } });

    const result = await actions.delete({ locals: { user: { id: 1 } }, request } as never);

    expect(result).toEqual({ status: 404, data: { error: 'Agent not found.' } });
  });
});
