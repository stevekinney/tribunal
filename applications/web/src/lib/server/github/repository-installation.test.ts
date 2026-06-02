import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import {
  createGitHubInstallationFactory,
  createRepositoryFactory,
  resetIdCounter,
} from '@tribunal/test/factories';
import type { GithubServiceContext } from '@tribunal/github/context';

import { getInstallationForRepository } from '@tribunal/github/repositories/service';

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

describe('getInstallationForRepository', () => {
  const setupFactories = () => ({
    githubInstallation: createGitHubInstallationFactory(testDb.db),
    repository: createRepositoryFactory(testDb.db),
  });

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

  it('returns not_found error when repository does not exist', async () => {
    const result = await getInstallationForRepository(getContext(), 999999);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not_found');
      expect(result.error).toBe('Repository not found');
    }
  });

  it('returns no_installation error when repository has no installationId', async () => {
    const factories = setupFactories();
    const repo = await factories.repository.create({
      installationId: null,
    });

    const result = await getInstallationForRepository(getContext(), repo.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('no_installation');
      expect(result.error).toBe('Repository has no associated GitHub installation');
    }
  });

  it('returns no_installation error when installation record is missing', async () => {
    const factories = setupFactories();
    // Create a repo with an installationId that doesn't have a matching installation record
    const repo = await factories.repository.create({
      installationId: 99999999,
    });

    const result = await getInstallationForRepository(getContext(), repo.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('no_installation');
      expect(result.error).toBe('GitHub installation not found');
    }
  });

  it('returns suspended error when installation is suspended', async () => {
    const factories = setupFactories();
    const installation = await factories.githubInstallation.create({
      status: 'suspended',
    });
    const repo = await factories.repository.create({
      installationId: installation.installationId,
    });

    const result = await getInstallationForRepository(getContext(), repo.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('suspended');
      expect(result.error).toBe('GitHub installation is suspended');
    }
  });

  it('returns error when installation status is needs_permissions', async () => {
    const factories = setupFactories();
    const installation = await factories.githubInstallation.create({
      status: 'needs_permissions',
    });
    const repo = await factories.repository.create({
      installationId: installation.installationId,
    });

    const result = await getInstallationForRepository(getContext(), repo.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('error');
      expect(result.error).toBe('GitHub installation is needs_permissions');
    }
  });

  // Note: Tests for getInstallationOctokit returning null and returning a valid client
  // require mocking at the GitHub App level (env vars) and are covered in integration tests.
  // The database lookup and status checking logic is fully tested above.
});
