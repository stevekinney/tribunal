import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import {
  githubInstallation,
  githubInstallationRepository,
  repository,
} from '@tribunal/database/schema';
import type { GithubServiceContext } from '../context.js';
import { refreshInstallationRepositories } from './service.js';

function createGithubContext(
  testContext: TestContext,
  repositories: Array<{
    id: number;
    owner: { login: string };
    name: string;
    default_branch: string;
  }>,
): GithubServiceContext {
  return {
    db: testContext.db as unknown as GithubServiceContext['db'],
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue({
      request: vi.fn(async (endpoint: string, options: { page?: number }) => {
        if (endpoint !== 'GET /installation/repositories') {
          throw new Error(`Unexpected GitHub endpoint: ${endpoint}`);
        }

        return {
          data: {
            repositories: options.page === 1 ? repositories : [],
          },
        };
      }),
    }),
    getGithubApplication: vi.fn().mockReturnValue(null),
  };
}

describe('refreshInstallationRepositories', () => {
  let testContext: TestContext;

  beforeAll(async () => {
    testContext = await createTestContext();
  });

  afterAll(async () => {
    await testContext.close();
  });

  beforeEach(async () => {
    await testContext.reset();
  });

  it('upserts current repositories and deactivates repositories no longer in the installation', async () => {
    expect.assertions(8);

    await testContext.factories.githubInstallation.create({
      installationId: 12345,
      accountLogin: 'test-org',
    });
    const removedRepository = await testContext.factories.repository.create({
      id: 999,
      owner: 'test-org',
      name: 'removed-repository',
      installationId: 12345,
    });
    await testContext.db.insert(githubInstallationRepository).values({
      installationId: 12345,
      repositoryId: removedRepository.id,
      isActive: true,
    });

    const context = createGithubContext(testContext, [
      {
        id: 100,
        owner: { login: 'test-org' },
        name: 'active-repository',
        default_branch: 'main',
      },
    ]);

    const result = await refreshInstallationRepositories(context, 12345);

    expect(result).toEqual({ repositoryCount: 1, deactivatedRepositoryCount: 1 });

    const [activeRepository] = await testContext.db
      .select()
      .from(repository)
      .where(eq(repository.id, 100));
    expect(activeRepository.owner).toBe('test-org');
    expect(activeRepository.name).toBe('active-repository');
    expect(activeRepository.defaultBranch).toBe('main');

    const activeLinks = await testContext.db
      .select()
      .from(githubInstallationRepository)
      .where(eq(githubInstallationRepository.repositoryId, 100));
    expect(activeLinks[0].isActive).toBe(true);

    const removedLinks = await testContext.db
      .select()
      .from(githubInstallationRepository)
      .where(eq(githubInstallationRepository.repositoryId, 999));
    expect(removedLinks[0].isActive).toBe(false);
    expect(removedLinks[0].removedAt).toBeInstanceOf(Date);

    const [installation] = await testContext.db
      .select()
      .from(githubInstallation)
      .where(eq(githubInstallation.installationId, 12345));
    expect(installation.lastSyncedAt).toBeInstanceOf(Date);
  });
});
