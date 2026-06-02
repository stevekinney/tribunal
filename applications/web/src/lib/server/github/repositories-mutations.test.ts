/**
 * Tests for repository mutation functions: updateRepositoryCommit
 * and updateRepositoryDefaultBranch.
 *
 * Uses PGlite-based test database for integration testing since these
 * functions modify database rows and their behavior (especially the
 * commit-null reset on branch change) is best verified against real SQL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createRepositoryFactory, resetIdCounter } from '@tribunal/test/factories';
import { eq } from 'drizzle-orm';
import { repository } from '@tribunal/database/schema';
import type { GithubServiceContext } from '@tribunal/github/context';

import {
  updateRepositoryCommit,
  updateRepositoryDefaultBranch,
} from '@tribunal/github/repositories/service';

let testDb: TestDatabase;

function createMockContext(overrides?: Partial<GithubServiceContext>): GithubServiceContext {
  return {
    db: undefined as any,
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
    getGithubApplication: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

describe('repository mutation functions', () => {
  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
    resetIdCounter();
  });

  function getContext(): GithubServiceContext {
    return createMockContext({ db: testDb.db as any });
  }

  describe('updateRepositoryCommit', () => {
    it('updates the commit SHA for a repository', async () => {
      const repositoryFactory = createRepositoryFactory(testDb.db);
      const repo = await repositoryFactory.create({
        owner: 'test-org',
        name: 'test-repo',
        commit: undefined,
      });

      await updateRepositoryCommit(getContext(), repo.id, 'abc123def456');

      const [updated] = await testDb.db
        .select({ commit: repository.commit })
        .from(repository)
        .where(eq(repository.id, repo.id));

      expect(updated.commit).toBe('abc123def456');
    });

    it('overwrites an existing commit SHA', async () => {
      const repositoryFactory = createRepositoryFactory(testDb.db);
      const repo = await repositoryFactory.create({
        commit: 'old-sha-111',
      });

      await updateRepositoryCommit(getContext(), repo.id, 'new-sha-222');

      const [updated] = await testDb.db
        .select({ commit: repository.commit })
        .from(repository)
        .where(eq(repository.id, repo.id));

      expect(updated.commit).toBe('new-sha-222');
    });

    it('updates the updatedAt timestamp', async () => {
      const repositoryFactory = createRepositoryFactory(testDb.db);
      const repo = await repositoryFactory.create();
      const originalUpdatedAt = repo.updatedAt;

      // Small delay to ensure timestamp differs
      await new Promise((resolve) => setTimeout(resolve, 10));
      await updateRepositoryCommit(getContext(), repo.id, 'new-sha');

      const [updated] = await testDb.db
        .select({ updatedAt: repository.updatedAt })
        .from(repository)
        .where(eq(repository.id, repo.id));

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
    });
  });

  describe('updateRepositoryDefaultBranch', () => {
    it('updates the default branch for a repository', async () => {
      const repositoryFactory = createRepositoryFactory(testDb.db);
      const repo = await repositoryFactory.create({
        defaultBranch: 'main',
      });

      await updateRepositoryDefaultBranch(getContext(), repo.id, 'develop');

      const [updated] = await testDb.db
        .select({
          defaultBranch: repository.defaultBranch,
        })
        .from(repository)
        .where(eq(repository.id, repo.id));

      expect(updated.defaultBranch).toBe('develop');
    });

    it('resets commit to null when default branch changes', async () => {
      const repositoryFactory = createRepositoryFactory(testDb.db);
      const repo = await repositoryFactory.create({
        defaultBranch: 'main',
        commit: 'old-sha-from-main',
      });

      await updateRepositoryDefaultBranch(getContext(), repo.id, 'develop');

      const [updated] = await testDb.db
        .select({
          defaultBranch: repository.defaultBranch,
          commit: repository.commit,
        })
        .from(repository)
        .where(eq(repository.id, repo.id));

      expect(updated.defaultBranch).toBe('develop');
      expect(updated.commit).toBeNull();
    });

    it('resets commit even when switching to a branch with a similar name prefix', async () => {
      const repositoryFactory = createRepositoryFactory(testDb.db);
      const repo = await repositoryFactory.create({
        defaultBranch: 'release',
        commit: 'sha-on-release',
      });

      await updateRepositoryDefaultBranch(getContext(), repo.id, 'release/v2');

      const [updated] = await testDb.db
        .select({
          defaultBranch: repository.defaultBranch,
          commit: repository.commit,
        })
        .from(repository)
        .where(eq(repository.id, repo.id));

      expect(updated.defaultBranch).toBe('release/v2');
      expect(updated.commit).toBeNull();
    });

    it('handles updating when commit was already null', async () => {
      const repositoryFactory = createRepositoryFactory(testDb.db);
      const repo = await repositoryFactory.create({
        defaultBranch: 'main',
        commit: undefined,
      });

      await updateRepositoryDefaultBranch(getContext(), repo.id, 'develop');

      const [updated] = await testDb.db
        .select({
          defaultBranch: repository.defaultBranch,
          commit: repository.commit,
        })
        .from(repository)
        .where(eq(repository.id, repo.id));

      expect(updated.defaultBranch).toBe('develop');
      expect(updated.commit).toBeNull();
    });
  });
});
