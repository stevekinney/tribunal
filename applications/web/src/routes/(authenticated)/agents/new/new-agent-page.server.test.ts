import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetReviewEffortOptions,
  mockGetReviewModelOptions,
  mockGetUserReviewSettings,
  mockSaveAgent,
} = vi.hoisted(() => ({
  mockGetReviewEffortOptions: vi.fn(),
  mockGetReviewModelOptions: vi.fn(),
  mockGetUserReviewSettings: vi.fn(),
  mockSaveAgent: vi.fn(),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$lib/server/review/operator', () => ({
  getReviewEffortOptions: mockGetReviewEffortOptions,
  getReviewModelOptions: mockGetReviewModelOptions,
  getUserReviewSettings: mockGetUserReviewSettings,
  saveAgent: mockSaveAgent,
}));

import { load, actions } from './+page.server';

describe('/agents/new load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReviewModelOptions.mockReturnValue(['inherit', 'sonnet']);
    mockGetReviewEffortOptions.mockReturnValue(['low', 'high']);
  });

  it('redirects to /login when no user is present', async () => {
    await expect(load({ locals: {} } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    });
  });

  it('resolves the inherited default model to sonnet', async () => {
    mockGetUserReviewSettings.mockResolvedValue([{ defaultModel: 'inherit' }]);

    const data = await load({ locals: { user: { id: 1 } } } as never);

    expect(data).toEqual({
      defaultModel: 'sonnet',
      modelOptions: ['inherit', 'sonnet'],
      effortOptions: ['low', 'high'],
    });
  });

  it('passes through a concrete default model unchanged', async () => {
    mockGetUserReviewSettings.mockResolvedValue([{ defaultModel: 'opus' }]);

    const data = (await load({ locals: { user: { id: 1 } } } as never)) as {
      defaultModel: string;
    };

    expect(data.defaultModel).toBe('opus');
  });
});

describe('/agents/new actions.save', () => {
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

  it('redirects to the new agent detail page on success', async () => {
    const request = { formData: vi.fn().mockResolvedValue(new FormData()) } as unknown as Request;
    mockSaveAgent.mockResolvedValue({ id: 'agent_new' });

    await expect(
      actions.save({ locals: { user: { id: 1 } }, request } as never),
    ).rejects.toMatchObject({ status: 303, location: '/agents/agent_new' });
  });

  it('returns the failure result without redirecting when save fails', async () => {
    const request = { formData: vi.fn().mockResolvedValue(new FormData()) } as unknown as Request;
    mockSaveAgent.mockResolvedValue({ status: 400, data: { error: 'Invalid.' } });

    const result = await actions.save({ locals: { user: { id: 1 } }, request } as never);

    expect(result).toEqual({ status: 400, data: { error: 'Invalid.' } });
  });
});
