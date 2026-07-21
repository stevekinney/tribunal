import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

const { mockGetReviewsEnabled } = vi.hoisted(() => ({ mockGetReviewsEnabled: vi.fn() }));

vi.mock('$lib/server/review/operator', () => ({
  getReviewsEnabled: mockGetReviewsEnabled,
}));

import { load } from './+layout.server';

describe('(authenticated) layout server load', () => {
  beforeEach(() => {
    mockGetReviewsEnabled.mockReset();
  });

  it('returns the user and global reviews-enabled state for an authenticated request', async () => {
    mockGetReviewsEnabled.mockResolvedValue(true);
    const user = { id: 1, username: 'steve' };
    const event = {
      locals: { user, neonSession: {} },
      url: new URL('http://localhost/repositories'),
    } as unknown as Parameters<typeof load>[0];

    const data = await load(event);

    expect(mockGetReviewsEnabled).toHaveBeenCalledWith(1);
    expect(data).toEqual({ user, reviewsEnabled: true });
  });

  it('redirects when no valid Neon session exists', async () => {
    const event = {
      locals: {
        user: null,
        neonSession: null,
      },
      url: new URL('http://localhost/repositories?filter=open'),
    } as Parameters<typeof load>[0];

    await expect(load(event)).rejects.toMatchObject({
      status: 302,
      location: '/login?returnTo=%2Frepositories%3Ffilter%3Dopen',
    });
    expect.assertions(1);
  });
});
