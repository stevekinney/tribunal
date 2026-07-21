import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetRunInspector } = vi.hoisted(() => ({ mockGetRunInspector: vi.fn() }));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$lib/server/review/operator', () => ({
  getRunInspector: mockGetRunInspector,
}));

import { load } from './+page.server';

describe('/runs/[runId] load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login when no user is present', async () => {
    await expect(load({ locals: {}, params: { runId: 'run_1' } } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    });
    expect(mockGetRunInspector).not.toHaveBeenCalled();
  });

  it('returns the run inspector data for the authenticated user', async () => {
    mockGetRunInspector.mockResolvedValue({ id: 'run_1', status: 'succeeded' });

    const data = await load({
      locals: { user: { id: 1 } },
      params: { runId: 'run_1' },
    } as never);

    expect(mockGetRunInspector).toHaveBeenCalledWith(1, 'run_1');
    expect(data).toEqual({ run: { id: 'run_1', status: 'succeeded' } });
  });
});
