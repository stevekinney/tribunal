import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetRepositoriesForUser,
  mockGetRepositoryOperatorDetails,
  mockGetUserReviewSettings,
  mockListAgents,
  mockSaveRepositoryWatchSettings,
  mockUserOwnsRepository,
} = vi.hoisted(() => ({
  mockGetRepositoriesForUser: vi.fn(),
  mockGetRepositoryOperatorDetails: vi.fn(),
  mockGetUserReviewSettings: vi.fn(),
  mockListAgents: vi.fn(),
  mockSaveRepositoryWatchSettings: vi.fn(),
  mockUserOwnsRepository: vi.fn(),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
  fail: (status: number, data: unknown) => ({ status, data, type: 'failure' }),
}));

vi.mock('$lib/server/repositories', () => ({
  getRepositoriesForUser: mockGetRepositoriesForUser,
}));

vi.mock('$lib/server/review/operator', () => ({
  getRepositoryOperatorDetails: mockGetRepositoryOperatorDetails,
  getUserReviewSettings: mockGetUserReviewSettings,
  listAgents: mockListAgents,
  saveRepositoryWatchSettings: mockSaveRepositoryWatchSettings,
  userOwnsRepository: mockUserOwnsRepository,
}));

import { actions, load } from './+page.server';

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

  it('returns "no_repositories" when installed but no repositories are accessible', async () => {
    mockGetRepositoriesForUser.mockResolvedValue({
      ok: true,
      repositories: [],
      installations: [{ installationId: 1, accountLogin: 'acme', accountAvatarUrl: null }],
    });

    await expect(runLoad()).resolves.toMatchObject({
      connectReason: 'no_repositories',
      repositories: [],
      installations: [{ installationId: 1, accountLogin: 'acme' }],
    });
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

  it('redirects unauthenticated requests to login', async () => {
    await expect(load({ locals: {} } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    });
  });
});

describe('onboarding watch action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserOwnsRepository.mockResolvedValue(true);
    mockSaveRepositoryWatchSettings.mockResolvedValue({ success: true });
    mockGetUserReviewSettings.mockResolvedValue([{ userId: 1, reviewsEnabled: true }]);
    // Nothing watched yet by default.
    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map());
    mockListAgents.mockResolvedValue([]);
  });

  function runWatch(repositoryIds: string[], userId: number | null = 1) {
    const formData = new FormData();
    for (const id of repositoryIds) formData.append('repositoryId', id);
    return actions.watch({
      locals: userId !== null ? { user: { id: userId } } : {},
      request: { formData: async () => formData },
    } as never);
  }

  it('watches each repository with the user’s enabled agents only', async () => {
    // Two enabled, one disabled — onboarding must assign the enabled pair, never
    // an empty list (which would leave the repository watched but unreviewed).
    mockListAgents.mockResolvedValue([
      { id: 'a1', enabled: true },
      { id: 'a2', enabled: false },
      { id: 'a3', enabled: true },
    ]);

    await expect(runWatch(['7'])).rejects.toMatchObject({
      status: 303,
      location: '/repositories?onboarded=1',
    });

    expect(mockSaveRepositoryWatchSettings).toHaveBeenCalledWith(1, {
      repositoryId: 7,
      watched: true,
      ignoreGlobs: [],
      agentIds: ['a1', 'a3'],
    });
  });

  it('seeds user_review_settings so the review fanout can claim intents', async () => {
    // Without a user_review_settings row the review-intent fanout's INNER JOIN
    // skips the user and no reviews ever run.
    await expect(runWatch(['7'])).rejects.toMatchObject({ status: 303 });
    expect(mockGetUserReviewSettings).toHaveBeenCalledWith(1);
  });

  it('skips repositories already watched so their saved settings are preserved', async () => {
    // Repo 7 is already watched (configured), repo 8 is new. Re-saving 7 would
    // wipe its ignore globs and agent assignments, so it must be skipped.
    mockGetRepositoryOperatorDetails.mockResolvedValue(new Map([[7, { watched: true }]]));

    await expect(runWatch(['7', '8'])).rejects.toMatchObject({ status: 303 });

    expect(mockSaveRepositoryWatchSettings).toHaveBeenCalledTimes(1);
    expect(mockSaveRepositoryWatchSettings).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ repositoryId: 8 }),
    );
  });

  it('redirects unauthenticated submissions to login', async () => {
    await expect(runWatch(['7'], null)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    });
  });

  it('rejects an empty selection', async () => {
    const result = await runWatch([]);

    expect(result).toMatchObject({
      status: 400,
      data: { error: 'Select at least one repository to watch.' },
    });
  });

  it('rejects a batch larger than the onboarding cap', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => String(index + 1));

    const result = await runWatch(ids);

    expect(result).toMatchObject({
      status: 400,
      data: { error: 'Too many repositories selected.' },
    });
  });

  it('rejects a non-integer repository id', async () => {
    const result = await runWatch(['not-a-number']);

    expect(result).toMatchObject({
      status: 400,
      data: { error: 'One or more repository IDs are invalid.' },
    });
  });

  it('rejects a batch containing a repository the user does not own', async () => {
    mockUserOwnsRepository.mockImplementation((_userId: number, repositoryId: number) =>
      Promise.resolve(repositoryId !== 8),
    );

    const result = await runWatch(['7', '8']);

    expect(result).toMatchObject({
      status: 403,
      data: { error: 'You do not have access to one or more repositories.' },
    });
    expect(mockSaveRepositoryWatchSettings).not.toHaveBeenCalled();
  });

  it('forwards an ActionFailure returned by a watch write instead of redirecting', async () => {
    const failure = { status: 400, data: { error: 'Could not save.' } };
    mockSaveRepositoryWatchSettings.mockResolvedValue(failure);

    const result = await runWatch(['7']);

    expect(result).toBe(failure);
  });
});
