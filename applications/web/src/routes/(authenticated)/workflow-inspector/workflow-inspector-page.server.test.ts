import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetRunsOverview, mockEnv } = vi.hoisted(() => ({
  mockGetRunsOverview: vi.fn(),
  mockEnv: { WEFT_INSPECTOR: '' } as Record<string, string>,
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

vi.mock('$lib/server/review/operator', () => ({
  getRunsOverview: mockGetRunsOverview,
  operatorSurfaceStates: ['empty', 'success'],
}));

import { load } from './+page.server';

describe('/workflow-inspector load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.WEFT_INSPECTOR = '';
  });

  it('redirects to /login when no user is present', async () => {
    await expect(load({ locals: {} } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    });
  });

  it('disables the inspector and returns no runs when WEFT_INSPECTOR is not set', async () => {
    const data = await load({
      locals: { user: { id: 1, isPlatformAdministrator: true } },
    } as never);

    expect(data).toEqual({ enabled: false, runs: [], surfaceStates: ['empty', 'success'] });
    expect(mockGetRunsOverview).not.toHaveBeenCalled();
  });

  it('disables the inspector for a non-administrator even when the flag is set', async () => {
    mockEnv.WEFT_INSPECTOR = '1';

    const data = (await load({
      locals: { user: { id: 1, isPlatformAdministrator: false } },
    } as never)) as { enabled: boolean };

    expect(data.enabled).toBe(false);
    expect(mockGetRunsOverview).not.toHaveBeenCalled();
  });

  it('enables the inspector and fetches runs for a platform administrator with the flag set', async () => {
    mockEnv.WEFT_INSPECTOR = '1';
    mockGetRunsOverview.mockResolvedValue([{ id: 'run_1' }]);

    const data = await load({
      locals: { user: { id: 1, isPlatformAdministrator: true } },
    } as never);

    expect(mockGetRunsOverview).toHaveBeenCalledWith(1);
    expect(data).toEqual({
      enabled: true,
      runs: [{ id: 'run_1' }],
      surfaceStates: ['empty', 'success'],
    });
  });
});
