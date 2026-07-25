import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDefaultModelOptions, mockGetUserReviewSettings, mockSaveUserReviewSettings } =
  vi.hoisted(() => ({
    mockGetDefaultModelOptions: vi.fn(),
    mockGetUserReviewSettings: vi.fn(),
    mockSaveUserReviewSettings: vi.fn(),
  }));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$lib/server/review/operator', () => ({
  getDefaultModelOptions: mockGetDefaultModelOptions,
  getUserReviewSettings: mockGetUserReviewSettings,
  operatorSurfaceStates: ['empty', 'success'],
  saveUserReviewSettings: mockSaveUserReviewSettings,
}));

import { load, actions } from './+page.server';

describe('/settings load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultModelOptions.mockReturnValue(['sonnet', 'opus']);
  });

  it('redirects to /login when no user is present', async () => {
    await expect(load({ locals: {} } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    });
  });

  it('passes the stored default model and options straight through, unmodified', async () => {
    mockGetUserReviewSettings.mockResolvedValue([{ defaultModel: 'opus', reviewsEnabled: true }]);

    const data = await load({ locals: { user: { id: 1 } } } as never);

    expect(data).toEqual({
      settings: { defaultModel: 'opus', reviewsEnabled: true },
      modelOptions: ['sonnet', 'opus'],
      surfaceStates: ['empty', 'success'],
    });
  });

  it('passes through a concrete default model unchanged', async () => {
    mockGetUserReviewSettings.mockResolvedValue([{ defaultModel: 'opus', reviewsEnabled: false }]);

    const data = (await load({ locals: { user: { id: 1 } } } as never)) as {
      settings: { defaultModel: string };
    };

    expect(data.settings.defaultModel).toBe('opus');
  });
});

describe('/settings actions.save', () => {
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

  it('delegates to saveUserReviewSettings with the submitted form data', async () => {
    const formData = new FormData();
    const request = { formData: vi.fn().mockResolvedValue(formData) } as unknown as Request;
    mockSaveUserReviewSettings.mockResolvedValue({ success: true });

    const result = await actions.save({ locals: { user: { id: 1 } }, request } as never);

    expect(mockSaveUserReviewSettings).toHaveBeenCalledWith(1, formData);
    expect(result).toEqual({ success: true });
  });
});
