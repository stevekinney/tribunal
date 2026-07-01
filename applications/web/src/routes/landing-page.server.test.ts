import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockHasWatchedRepositories, mockIsNeonAuthConfigured } = vi.hoisted(() => ({
  mockHasWatchedRepositories: vi.fn(),
  mockIsNeonAuthConfigured: vi.fn(),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$lib/server/review/operator', () => ({
  hasWatchedRepositories: mockHasWatchedRepositories,
}));

vi.mock('$lib/server/auth/neon-auth-configured', () => ({
  isNeonAuthConfigured: mockIsNeonAuthConfigured,
}));

import { load } from './+page.server';

function runLoad(user: { id: number } | null) {
  return load({ locals: { user } } as never);
}

describe('/ load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes neonAuthConfigured to the welcome screen when signed out', async () => {
    mockIsNeonAuthConfigured.mockReturnValue(true);

    await expect(runLoad(null)).resolves.toEqual({ neonAuthConfigured: true });
    expect(mockHasWatchedRepositories).not.toHaveBeenCalled();
  });

  it('sends a returning user with watched repositories to /repositories', async () => {
    mockHasWatchedRepositories.mockResolvedValue(true);

    await expect(runLoad({ id: 1 })).rejects.toMatchObject({
      status: 302,
      location: '/repositories',
    });
  });

  it('sends a first-time user to /onboarding', async () => {
    mockHasWatchedRepositories.mockResolvedValue(false);

    await expect(runLoad({ id: 1 })).rejects.toMatchObject({
      status: 302,
      location: '/onboarding',
    });
  });
});
