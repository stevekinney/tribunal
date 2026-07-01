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

import { getRepositoriesForUser } from './repositories';

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
});
