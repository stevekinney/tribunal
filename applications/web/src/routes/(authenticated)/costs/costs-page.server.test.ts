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

  // Per-run cost reconciliation was removed (see #215): the Anthropic cost
  // report endpoint has no per-run dimension, so `/costs` only ever shows
  // estimated spend now. A `?source=reconciled` query param is ignored.
  it('always loads the estimate cost source', async () => {
    await load({ locals: { user: { id: 1 } }, url: new URL('http://localhost/costs') } as never);

    expect(mockGetCostOverview).toHaveBeenCalledWith(1, 'estimate');
  });

  it('ignores a source query param and still loads the estimate source', async () => {
    await load({
      locals: { user: { id: 1 } },
      url: new URL('http://localhost/costs?source=reconciled'),
    } as never);

    expect(mockGetCostOverview).toHaveBeenCalledWith(1, 'estimate');
  });
});
