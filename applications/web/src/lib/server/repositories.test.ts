import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { runWithDatabase } from '$lib/server/database';
import {
  githubInstallation,
  githubInstallationRepository,
  repository,
  user,
} from '@tribunal/database/schema';

const { mockEnv, mockGetUserOctokit, mockGithubRequest } = vi.hoisted(() => ({
  mockEnv: {
    GITHUB_APP_NAME: 'tribunal-review',
    NODE_ENV: 'test',
    E2E_TEST_MODE: '0',
    E2E_TEST_SECRET: '',
    DEV_AUTH_BYPASS: '',
    DEV_AUTH_BYPASS_MODE: '',
  },
  mockGetUserOctokit: vi.fn(),
  mockGithubRequest: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({
  get env() {
    return mockEnv;
  },
}));

vi.mock('$lib/server/github/user-oauth', () => ({
  getUserOctokit: mockGetUserOctokit,
}));

const mockMarkGitHubTokenInvalid = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/github/access', () => ({
  markGitHubTokenInvalid: mockMarkGitHubTokenInvalid,
}));

import { getRepositoriesForUser, userCanAccessRepository } from './repositories';

describe('getRepositoriesForUser', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
    mockEnv.GITHUB_APP_NAME = 'tribunal-review';
    mockEnv.NODE_ENV = 'test';
    mockEnv.E2E_TEST_MODE = '0';
    mockEnv.E2E_TEST_SECRET = '';
    mockEnv.DEV_AUTH_BYPASS = '';
    mockEnv.DEV_AUTH_BYPASS_MODE = '';
    mockMarkGitHubTokenInvalid.mockReset().mockResolvedValue(undefined);
    mockGetUserOctokit.mockReset();
    mockGetUserOctokit.mockResolvedValue({
      ok: true,
      octokit: {
        request: mockGithubRequest,
      },
      scopes: {},
    });
    mockGithubRequest.mockReset();
    mockGithubRequest.mockImplementation(async (endpoint: string, options?: { page?: number }) => {
      if (endpoint !== 'GET /user/installations') {
        throw new Error(`Unexpected GitHub endpoint: ${endpoint}`);
      }

      return {
        data: {
          installations:
            (options?.page ?? 1) === 1
              ? [
                  {
                    id: 12345,
                    app_slug: 'tribunal-review',
                    account: {
                      login: 'test-org',
                      avatar_url: 'https://example.test/test-org.png',
                    },
                  },
                ]
              : [],
        },
      };
    });
  });

  function withTestDatabase<T>(operation: () => Promise<T>): Promise<T> {
    return runWithDatabase(testDb.db as never, operation);
  }

  async function createLocalRepositoryGraph() {
    const [owner] = await testDb.db
      .insert(user)
      .values({
        username: 'dev-user',
        neonAuthUserId: 'dev-github:123',
      })
      .returning();

    const [installation] = await testDb.db
      .insert(githubInstallation)
      .values({
        installationId: 12345,
        userId: owner.id,
        accountLogin: 'test-org',
        accountType: 'Organization',
        accountId: 67890,
        accountAvatarUrl: 'https://example.test/test-org.png',
        repositorySelection: 'all',
        status: 'active',
      })
      .returning();

    const [repo] = await testDb.db
      .insert(repository)
      .values({
        id: 98765,
        owner: 'test-org',
        name: 'test-repo',
        uri: 'https://github.com/test-org/test-repo.git',
        installationId: installation.installationId,
      })
      .returning();

    await testDb.db.insert(githubInstallationRepository).values({
      installationId: installation.installationId,
      repositoryId: repo.id,
      isActive: true,
    });

    return { owner, repo, installation };
  }

  it('returns live GitHub App installations before local installation rows are synced', async () => {
    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result).toMatchObject({
      ok: true,
      repositories: [],
      installations: [
        {
          installationId: 12345,
          accountLogin: 'test-org',
          accountAvatarUrl: 'https://example.test/test-org.png',
        },
      ],
    });
    expect.assertions(1);
  });

  it('ignores live installations for other GitHub Apps', async () => {
    mockGithubRequest.mockImplementation(async (endpoint: string, options?: { page?: number }) => {
      if (endpoint !== 'GET /user/installations') {
        throw new Error(`Unexpected GitHub endpoint: ${endpoint}`);
      }

      return {
        data: {
          installations:
            (options?.page ?? 1) === 1
              ? [
                  {
                    id: 67890,
                    app_slug: 'other-app',
                    account: {
                      login: 'other-org',
                      avatar_url: 'https://example.test/other-org.png',
                    },
                  },
                ]
              : [],
        },
      };
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result).toMatchObject({
      ok: true,
      repositories: [],
      installations: [],
    });
    expect.assertions(1);
  });

  it('maps a 401 from GitHub to no_github_token (revoked/expired token)', async () => {
    // A 401 means the stored OAuth token is dead. It must surface as
    // `no_github_token` (a reconnect prompt) — not `github_unavailable`, which
    // would imply a transient outage and re-use the dead token on every load.
    mockGithubRequest.mockImplementation(async () => {
      throw Object.assign(new Error('Bad credentials'), { status: 401 });
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result).toMatchObject({ ok: false, error: 'no_github_token' });
    expect.assertions(1);
  });

  it('uses local installation rows in dev GitHub bypass when no app OAuth token exists', async () => {
    const { owner } = await createLocalRepositoryGraph();
    mockEnv.DEV_AUTH_BYPASS = '1';
    mockEnv.DEV_AUTH_BYPASS_MODE = 'github';
    mockGetUserOctokit.mockResolvedValue({
      ok: false,
      error: 'no_token',
      message: 'No GitHub connection found. Please connect your GitHub account.',
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(owner.id));

    expect(result).toMatchObject({
      ok: true,
      repositories: [
        {
          repository: {
            id: 98765,
            owner: 'test-org',
            name: 'test-repo',
          },
          installation: {
            installationId: 12345,
            accountLogin: 'test-org',
            accountAvatarUrl: 'https://example.test/test-org.png',
          },
        },
      ],
      installations: [
        {
          installationId: 12345,
          accountLogin: 'test-org',
          accountAvatarUrl: 'https://example.test/test-org.png',
        },
      ],
    });
    expect(mockGithubRequest).not.toHaveBeenCalled();
  });

  it('uses local installation rows in dev GitHub bypass when the token cannot list app installations', async () => {
    const { owner } = await createLocalRepositoryGraph();
    mockEnv.DEV_AUTH_BYPASS = '1';
    mockEnv.DEV_AUTH_BYPASS_MODE = 'github';
    mockGithubRequest.mockImplementation(async () => {
      throw Object.assign(new Error('Resource not accessible by personal access token'), {
        status: 403,
      });
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(owner.id));

    expect(result).toMatchObject({
      ok: true,
      repositories: [
        {
          repository: {
            id: 98765,
            owner: 'test-org',
            name: 'test-repo',
          },
        },
      ],
      installations: [{ installationId: 12345, accountLogin: 'test-org' }],
    });
  });

  it('maps a non-401 GitHub error to github_unavailable (transient)', async () => {
    mockGithubRequest.mockImplementation(async () => {
      throw Object.assign(new Error('Service unavailable'), { status: 503 });
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result).toMatchObject({ ok: false, error: 'github_unavailable' });
    expect.assertions(1);
  });

  it('uses live GitHub installations in production even if E2E variables are present', async () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.E2E_TEST_MODE = '1';
    mockEnv.E2E_TEST_SECRET = 'secret';

    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result).toMatchObject({
      ok: true,
      repositories: [],
      installations: [
        {
          installationId: 12345,
          accountLogin: 'test-org',
          accountAvatarUrl: 'https://example.test/test-org.png',
        },
      ],
    });
  });

  it('uses local installation rows outside production when E2E variables are set (no GitHub call)', async () => {
    const { owner } = await createLocalRepositoryGraph();
    mockEnv.NODE_ENV = 'test';
    mockEnv.E2E_TEST_MODE = '1';
    mockEnv.E2E_TEST_SECRET = 'secret';

    const result = await withTestDatabase(() => getRepositoriesForUser(owner.id));

    expect(result).toMatchObject({
      ok: true,
      repositories: [{ repository: { id: 98765 } }],
    });
    expect(mockGetUserOctokit).not.toHaveBeenCalled();
    expect(mockGithubRequest).not.toHaveBeenCalled();
  });

  it('returns no_github_token directly when the OAuth token itself is missing/invalid (no dev bypass)', async () => {
    mockGetUserOctokit.mockResolvedValue({
      ok: false,
      error: 'no_token',
      message: 'No GitHub connection found. Please connect your GitHub account.',
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result).toEqual({
      ok: false,
      error: 'no_github_token',
      message: 'No GitHub connection found. Please connect your GitHub account.',
    });
    expect(mockGithubRequest).not.toHaveBeenCalled();
  });

  it('marks the GitHub token invalid and returns no_github_token on a 401 (no dev bypass configured)', async () => {
    mockGithubRequest.mockImplementation(async () => {
      throw Object.assign(new Error('Bad credentials'), { status: 401 });
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(7));

    expect(result).toMatchObject({ ok: false, error: 'no_github_token' });
    expect(mockMarkGitHubTokenInvalid).toHaveBeenCalledWith(7);
  });

  it('falls back to an installation-id label and the account slug/name when a live installation has no login', async () => {
    mockGithubRequest.mockImplementation(async (endpoint: string, options?: { page?: number }) => {
      if (endpoint !== 'GET /user/installations') {
        throw new Error(`Unexpected GitHub endpoint: ${endpoint}`);
      }
      return {
        data: {
          installations:
            (options?.page ?? 1) === 1
              ? [
                  { id: 111, app_slug: 'tribunal-review', account: null },
                  {
                    id: 222,
                    app_slug: 'tribunal-review',
                    account: { slug: 'acme-org', avatar_url: null },
                  },
                ]
              : [],
        },
      };
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result).toMatchObject({
      ok: true,
      installations: expect.arrayContaining([
        { installationId: 111, accountLogin: 'installation-111', accountAvatarUrl: null },
        { installationId: 222, accountLogin: 'acme-org', accountAvatarUrl: null },
      ]),
    });
  });

  it('sorts installations and repositories deterministically, including ties (live path)', async () => {
    const [owner] = await testDb.db
      .insert(user)
      .values({ username: 'dev-user-2', neonAuthUserId: 'dev-github:456' })
      .returning();

    await testDb.db.insert(githubInstallation).values([
      {
        installationId: 12345,
        userId: owner.id,
        accountLogin: 'test-org',
        accountType: 'Organization',
        accountId: 67890,
        accountAvatarUrl: 'https://example.test/test-org.png',
        repositorySelection: 'all',
        status: 'active',
      },
    ]);

    await testDb.db.insert(repository).values([
      {
        id: 1001,
        owner: 'test-org',
        name: 'b-repo',
        uri: 'https://github.com/test-org/b-repo.git',
        installationId: 12345,
      },
      {
        id: 1002,
        owner: 'test-org',
        name: 'a-repo',
        uri: 'https://github.com/test-org/a-repo.git',
        installationId: 12345,
      },
    ]);

    await testDb.db.insert(githubInstallationRepository).values([
      { installationId: 12345, repositoryId: 1001, isActive: true },
      { installationId: 12345, repositoryId: 1002, isActive: true },
    ]);

    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Same-installation tie in the installations sort exercises the
      // accountLogin === accountLogin branch (returns 0), and a-repo before
      // b-repo (same owner) exercises the name comparator.
      expect(result.installations).toHaveLength(1);
      expect(result.repositories.map((r) => r.repository.name)).toEqual(['a-repo', 'b-repo']);
    }
  });

  it('treats two repositories with the same owner and name as equal in the sort comparator (live path)', async () => {
    const [owner] = await testDb.db
      .insert(user)
      .values({ username: 'dev-user-tie', neonAuthUserId: 'dev-github:tie' })
      .returning();

    await testDb.db.insert(githubInstallation).values({
      installationId: 12345,
      userId: owner.id,
      accountLogin: 'test-org',
      accountType: 'Organization',
      accountId: 67890,
      repositorySelection: 'all',
      status: 'active',
    });

    await testDb.db.insert(repository).values([
      {
        id: 3001,
        owner: 'dup-org',
        name: 'dup-repo',
        uri: 'https://github.com/dup-org/dup-repo-1.git',
        installationId: 12345,
      },
      {
        id: 3002,
        owner: 'dup-org',
        name: 'dup-repo',
        uri: 'https://github.com/dup-org/dup-repo-2.git',
        installationId: 12345,
      },
    ]);

    await testDb.db.insert(githubInstallationRepository).values([
      { installationId: 12345, repositoryId: 3001, isActive: true },
      { installationId: 12345, repositoryId: 3002, isActive: true },
    ]);

    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repositories.map((r) => r.repository.id).sort()).toEqual([3001, 3002]);
    }
  });

  it('orders two repositories with different owners by owner (live path)', async () => {
    const [owner] = await testDb.db
      .insert(user)
      .values({ username: 'owner-only', neonAuthUserId: 'dev-github:owner-only' })
      .returning();

    // The live path resolves installations from the mocked GitHub API (always
    // installation 12345), not from `githubInstallation.userId`, so this row's
    // owner does not need to match the user id passed to getRepositoriesForUser.
    await testDb.db.insert(githubInstallation).values({
      installationId: 12345,
      userId: owner.id,
      accountLogin: 'test-org',
      accountType: 'Organization',
      accountId: 67890,
      repositorySelection: 'all',
      status: 'active',
    });

    await testDb.db.insert(repository).values([
      {
        id: 5001,
        owner: 'zzz-owner',
        name: 'repo',
        uri: 'https://github.com/zzz-owner/repo.git',
        installationId: 12345,
      },
      {
        id: 5002,
        owner: 'aaa-owner',
        name: 'repo',
        uri: 'https://github.com/aaa-owner/repo.git',
        installationId: 12345,
      },
    ]);

    await testDb.db.insert(githubInstallationRepository).values([
      { installationId: 12345, repositoryId: 5001, isActive: true },
      { installationId: 12345, repositoryId: 5002, isActive: true },
    ]);

    const result = await withTestDatabase(() => getRepositoriesForUser(1));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repositories.map((r) => r.repository.owner)).toEqual([
        'aaa-owner',
        'zzz-owner',
      ]);
    }
  });

  it('sorts local (dev-bypass) repositories and installations deterministically, including a same-owner tie', async () => {
    const [owner] = await testDb.db
      .insert(user)
      .values({ username: 'dev-user-3', neonAuthUserId: 'dev-github:789' })
      .returning();

    await testDb.db.insert(githubInstallation).values({
      installationId: 55555,
      userId: owner.id,
      accountLogin: 'zzz-org',
      accountType: 'Organization',
      accountId: 11111,
      repositorySelection: 'all',
      status: 'active',
    });

    await testDb.db.insert(repository).values([
      {
        id: 2001,
        owner: 'zzz-org',
        name: 'zeta',
        uri: 'https://github.com/zzz-org/zeta.git',
        installationId: 55555,
      },
      {
        id: 2002,
        owner: 'zzz-org',
        name: 'alpha',
        uri: 'https://github.com/zzz-org/alpha.git',
        installationId: 55555,
      },
    ]);

    await testDb.db.insert(githubInstallationRepository).values([
      { installationId: 55555, repositoryId: 2001, isActive: true },
      { installationId: 55555, repositoryId: 2002, isActive: true },
    ]);

    mockEnv.DEV_AUTH_BYPASS = '1';
    mockEnv.DEV_AUTH_BYPASS_MODE = 'github';
    mockGetUserOctokit.mockResolvedValue({
      ok: false,
      error: 'no_token',
      message: 'No GitHub connection found. Please connect your GitHub account.',
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(owner.id));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repositories.map((r) => r.repository.name)).toEqual(['alpha', 'zeta']);
      expect(result.installations).toEqual([
        { installationId: 55555, accountLogin: 'zzz-org', accountAvatarUrl: null },
      ]);
    }
  });

  it('treats two repositories with the same owner/name, and two installations with the same login, as equal in the local-path comparators', async () => {
    const [owner] = await testDb.db
      .insert(user)
      .values({ username: 'dev-user-4', neonAuthUserId: 'dev-github:tie-local' })
      .returning();

    await testDb.db.insert(githubInstallation).values([
      {
        installationId: 66661,
        userId: owner.id,
        accountLogin: 'same-org',
        accountType: 'Organization',
        accountId: 22221,
        repositorySelection: 'all',
        status: 'active',
      },
      {
        installationId: 66662,
        userId: owner.id,
        accountLogin: 'same-org',
        accountType: 'Organization',
        accountId: 22222,
        repositorySelection: 'all',
        status: 'active',
      },
    ]);

    await testDb.db.insert(repository).values([
      {
        id: 4001,
        owner: 'dup-org',
        name: 'dup-repo',
        uri: 'https://github.com/dup-org/dup-repo-1.git',
        installationId: 66661,
      },
      {
        id: 4002,
        owner: 'dup-org',
        name: 'dup-repo',
        uri: 'https://github.com/dup-org/dup-repo-2.git',
        installationId: 66662,
      },
    ]);

    await testDb.db.insert(githubInstallationRepository).values([
      { installationId: 66661, repositoryId: 4001, isActive: true },
      { installationId: 66662, repositoryId: 4002, isActive: true },
    ]);

    mockEnv.DEV_AUTH_BYPASS = '1';
    mockEnv.DEV_AUTH_BYPASS_MODE = 'github';
    mockGetUserOctokit.mockResolvedValue({
      ok: false,
      error: 'no_token',
      message: 'No GitHub connection found. Please connect your GitHub account.',
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(owner.id));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repositories.map((r) => r.repository.id).sort()).toEqual([4001, 4002]);
      expect(result.installations).toHaveLength(2);
    }
  });

  it('orders two repositories with different owners, and two installations with different logins, by their differing values (local path)', async () => {
    const [owner] = await testDb.db
      .insert(user)
      .values({ username: 'dev-user-5', neonAuthUserId: 'dev-github:diff-local' })
      .returning();

    await testDb.db.insert(githubInstallation).values([
      {
        installationId: 77771,
        userId: owner.id,
        accountLogin: 'zzz-org',
        accountType: 'Organization',
        accountId: 33331,
        repositorySelection: 'all',
        status: 'active',
      },
      {
        installationId: 77772,
        userId: owner.id,
        accountLogin: 'aaa-org',
        accountType: 'Organization',
        accountId: 33332,
        repositorySelection: 'all',
        status: 'active',
      },
    ]);

    await testDb.db.insert(repository).values([
      {
        id: 6001,
        owner: 'zzz-owner',
        name: 'repo',
        uri: 'https://github.com/zzz-owner/repo.git',
        installationId: 77771,
      },
      {
        id: 6002,
        owner: 'aaa-owner',
        name: 'repo',
        uri: 'https://github.com/aaa-owner/repo.git',
        installationId: 77772,
      },
    ]);

    await testDb.db.insert(githubInstallationRepository).values([
      { installationId: 77771, repositoryId: 6001, isActive: true },
      { installationId: 77772, repositoryId: 6002, isActive: true },
    ]);

    mockEnv.DEV_AUTH_BYPASS = '1';
    mockEnv.DEV_AUTH_BYPASS_MODE = 'github';
    mockGetUserOctokit.mockResolvedValue({
      ok: false,
      error: 'no_token',
      message: 'No GitHub connection found. Please connect your GitHub account.',
    });

    const result = await withTestDatabase(() => getRepositoriesForUser(owner.id));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repositories.map((r) => r.repository.owner)).toEqual([
        'aaa-owner',
        'zzz-owner',
      ]);
      expect(result.installations.map((i) => i.accountLogin)).toEqual(['aaa-org', 'zzz-org']);
    }
  });

  it('returns true when userCanAccessRepository finds the repository among the user’s accessible repositories', async () => {
    const { owner } = await createLocalRepositoryGraph();
    mockEnv.DEV_AUTH_BYPASS = '1';
    mockEnv.DEV_AUTH_BYPASS_MODE = 'github';
    mockGetUserOctokit.mockResolvedValue({
      ok: false,
      error: 'no_token',
      message: 'No GitHub connection found. Please connect your GitHub account.',
    });

    await expect(withTestDatabase(() => userCanAccessRepository(owner.id, 98765))).resolves.toBe(
      true,
    );
  });

  it('returns false when the repository is not accessible', async () => {
    const { owner } = await createLocalRepositoryGraph();
    mockEnv.DEV_AUTH_BYPASS = '1';
    mockEnv.DEV_AUTH_BYPASS_MODE = 'github';
    mockGetUserOctokit.mockResolvedValue({
      ok: false,
      error: 'no_token',
      message: 'No GitHub connection found. Please connect your GitHub account.',
    });

    await expect(withTestDatabase(() => userCanAccessRepository(owner.id, 999999))).resolves.toBe(
      false,
    );
  });

  it('returns false when repository resolution itself fails', async () => {
    mockGithubRequest.mockImplementation(async () => {
      throw Object.assign(new Error('Service unavailable'), { status: 503 });
    });

    await expect(withTestDatabase(() => userCanAccessRepository(1, 98765))).resolves.toBe(false);
  });
});
