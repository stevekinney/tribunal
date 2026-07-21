import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetRunsOverview } = vi.hoisted(() => ({ mockGetRunsOverview: vi.fn() }));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$lib/server/review/operator', () => ({
  getRunsOverview: mockGetRunsOverview,
  operatorSurfaceStates: ['empty', 'success'],
}));

import { load } from './+page.server';

describe('/runs load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login when no user is present', async () => {
    await expect(load({ locals: {} } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    });
    expect(mockGetRunsOverview).not.toHaveBeenCalled();
  });

  it('returns the runs overview and surface states for the authenticated user', async () => {
    mockGetRunsOverview.mockResolvedValue([{ id: 'run_1' }]);

    const data = await load({ locals: { user: { id: 1 } } } as never);

    expect(mockGetRunsOverview).toHaveBeenCalledWith(1);
    expect(data).toEqual({ runs: [{ id: 'run_1' }], surfaceStates: ['empty', 'success'] });
  });
});
