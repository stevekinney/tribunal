import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetRepositoriesForUser, mockGetRepositoryOperatorDetails } = vi.hoisted(() => ({
  mockGetRepositoriesForUser: vi.fn(),
  mockGetRepositoryOperatorDetails: vi.fn(),
}));

vi.mock('$lib/server/repositories', () => ({
  getRepositoriesForUser: mockGetRepositoriesForUser,
}));

vi.mock('$lib/server/review/operator', () => ({
  getRepositoryOperatorDetails: mockGetRepositoryOperatorDetails,
  saveRepositoryWatchSettings: vi.fn(),
  userOwnsRepository: vi.fn(),
}));

import { load } from './+page.server';

// The load only reads locals.user; a minimal event is enough for these cases.
function runLoad() {
  return load({ locals: { user: { id: 1 } } } as never);
}

describe('onboarding load: connectReason discrimination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "disconnected" when the GitHub token is missing or revoked', async () => {
    mockGetRepositoriesForUser.mockResolvedValue({
      ok: false,
      error: 'no_github_token',
      message: 'x',
    });

    await expect(runLoad()).resolves.toMatchObject({
      connectReason: 'disconnected',
      repositories: [],
      installations: [],
    });
  });

  it('returns "unavailable" on a transient GitHub error', async () => {
    mockGetRepositoriesForUser.mockResolvedValue({
      ok: false,
      error: 'github_unavailable',
      message: 'x',
    });

    await expect(runLoad()).resolves.toMatchObject({ connectReason: 'unavailable' });
  });

  it('returns "no_installation" when connected but no app is installed', async () => {
    mockGetRepositoriesForUser.mockResolvedValue({ ok: true, repositories: [], installations: [] });

    await expect(runLoad()).resolves.toMatchObject({ connectReason: 'no_installation' });
  });

  it('returns the picker (connectReason null) when installations exist', async () => {
    mockGetRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [{ repository: { id: 7, owner: 'acme', name: 'web', defaultBranch: 'main' } }],
      installations: [{ installationId: 1, accountLogin: 'acme', accountAvatarUrl: null }],
    });
    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map([[7, { watched: true }]]));

    await expect(runLoad()).resolves.toMatchObject({
      connectReason: null,
      repositories: [{ id: 7, owner: 'acme', name: 'web', defaultBranch: 'main', watched: true }],
      installations: [{ installationId: 1, accountLogin: 'acme' }],
    });
  });
});
