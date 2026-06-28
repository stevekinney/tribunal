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

  it('skips repository mutations when the sync attempt no longer owns the installation', async () => {
    expect.assertions(8);

    await testContext.factories.githubInstallation.create({
      installationId: 12345,
      accountLogin: 'test-org',
    });
    await testContext.db
      .update(githubInstallation)
      .set({
        syncStatus: 'in_progress',
        syncError: 'still syncing',
        syncWorkflowExecutionToken: 'current-workflow',
        syncActivityAttemptToken: 'current-attempt',
      })
      .where(eq(githubInstallation.installationId, 12345));
    const existingRepository = await testContext.factories.repository.create({
      id: 999,
      owner: 'test-org',
      name: 'existing-repository',
      installationId: 12345,
    });
    await testContext.db.insert(githubInstallationRepository).values({
      installationId: 12345,
      repositoryId: existingRepository.id,
      isActive: true,
    });

    const context = createGithubContext(testContext, [
      {
        id: 100,
        owner: { login: 'test-org' },
        name: 'stale-attempt-repository',
        default_branch: 'main',
      },
    ]);

    const result = await refreshInstallationRepositories(context, 12345, {
      syncWorkflowExecutionToken: 'current-workflow',
      syncActivityAttemptToken: 'stale-attempt',
    });

    expect(result).toEqual({ repositoryCount: 0, deactivatedRepositoryCount: 0 });

    const staleAttemptRepositories = await testContext.db
      .select()
      .from(repository)
      .where(eq(repository.id, 100));
    expect(staleAttemptRepositories).toHaveLength(0);

    const [existingLink] = await testContext.db
      .select()
      .from(githubInstallationRepository)
      .where(eq(githubInstallationRepository.repositoryId, 999));
    expect(existingLink.isActive).toBe(true);
    expect(existingLink.removedAt).toBeNull();

    const [installation] = await testContext.db
      .select()
      .from(githubInstallation)
      .where(eq(githubInstallation.installationId, 12345));
    expect(installation.syncStatus).toBe('in_progress');
    expect(installation.syncError).toBe('still syncing');
    expect(installation.syncWorkflowExecutionToken).toBe('current-workflow');
    expect(installation.syncActivityAttemptToken).toBe('current-attempt');
  });

  it('settles a failed interrupted row when sync owner tokens still match', async () => {
    expect.assertions(6);

    await testContext.factories.githubInstallation.create({
      installationId: 12345,
      accountLogin: 'test-org',
    });
    await testContext.db
      .update(githubInstallation)
      .set({
        syncStatus: 'failed',
        syncError: 'Sync interrupted before completion (cancelled, stopped, or timed out).',
        syncWorkflowExecutionToken: 'workflow-token',
        syncActivityAttemptToken: 'activity-token',
      })
      .where(eq(githubInstallation.installationId, 12345));

    const context = createGithubContext(testContext, [
      {
        id: 100,
        owner: { login: 'test-org' },
        name: 'active-repository',
        default_branch: 'main',
      },
    ]);

    const result = await refreshInstallationRepositories(context, 12345, {
      syncWorkflowExecutionToken: 'workflow-token',
      syncActivityAttemptToken: 'activity-token',
    });

    expect(result).toEqual({ repositoryCount: 1, deactivatedRepositoryCount: 0 });

    const [activeRepository] = await testContext.db
      .select()
      .from(repository)
      .where(eq(repository.id, 100));
    expect(activeRepository.name).toBe('active-repository');

    const [installation] = await testContext.db
      .select()
      .from(githubInstallation)
      .where(eq(githubInstallation.installationId, 12345));
    expect(installation.syncStatus).toBe('idle');
    expect(installation.syncError).toBeNull();
    expect(installation.syncWorkflowExecutionToken).toBeNull();
    expect(installation.syncActivityAttemptToken).toBeNull();
  });
});
