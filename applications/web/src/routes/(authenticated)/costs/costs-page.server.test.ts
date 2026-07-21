import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCostOverview } = vi.hoisted(() => ({ mockGetCostOverview: vi.fn() }));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$lib/server/review/operator', () => ({
  getCostOverview: mockGetCostOverview,
  operatorSurfaceStates: ['empty', 'success'],
}));

import { load } from './+page.server';

describe('/costs load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCostOverview.mockResolvedValue({ total: 0 });
  });

  it('redirects to /login when no user is present', async () => {
    await expect(
      load({ locals: {}, url: new URL('http://localhost/costs') } as never),
    ).rejects.toMatchObject({ status: 302, location: '/login' });
  });

  it('defaults to the estimate cost source', async () => {
    await load({ locals: { user: { id: 1 } }, url: new URL('http://localhost/costs') } as never);

    expect(mockGetCostOverview).toHaveBeenCalledWith(1, 'estimate');
  });

  it('uses the reconciled source when requested via query param', async () => {
    await load({
      locals: { user: { id: 1 } },
      url: new URL('http://localhost/costs?source=reconciled'),
    } as never);

    expect(mockGetCostOverview).toHaveBeenCalledWith(1, 'reconciled');
  });

  it('falls back to estimate for an unrecognized source value', async () => {
    await load({
      locals: { user: { id: 1 } },
      url: new URL('http://localhost/costs?source=bogus'),
    } as never);

    expect(mockGetCostOverview).toHaveBeenCalledWith(1, 'estimate');
  });
});
