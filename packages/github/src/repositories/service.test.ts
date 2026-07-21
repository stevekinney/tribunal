import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import {
  githubInstallation,
  githubInstallationRepository,
  repository,
} from '@tribunal/database/schema';
import type { GithubServiceContext } from '../context.js';
import {
  refreshInstallationRepositories,
  parseFilters,
  filterRepositories,
  sortRepositories,
  paginateRepositories,
  getRepositoryById,
  getRepositoryByOwnerAndName,
  getOrCreateRepository,
  getRepositoryIdsByOwner,
  updateRepositoryMetadata,
  updateRepositoryDefaultBranch,
  updateRepositoryCommit,
  getInstallationForRepository,
  getInstallationIdForRepository,
  markInstallationRepositoryInactive,
  type RepositoryListItem,
} from './service.js';

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
    expect.assertions(9);

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

    await expect(
      refreshInstallationRepositories(context, 12345, {
        syncWorkflowExecutionToken: 'current-workflow',
        syncActivityAttemptToken: 'stale-attempt',
      }),
    ).rejects.toThrow('Installation sync ownership lost');
    expect(context.getInstallationOctokit).not.toHaveBeenCalled();

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

  it('preserves live durable sync status during tokenless setup refreshes', async () => {
    expect.assertions(6);

    await testContext.factories.githubInstallation.create({
      installationId: 12345,
      accountLogin: 'test-org',
    });
    await testContext.db
      .update(githubInstallation)
      .set({
        syncStatus: 'in_progress',
        syncError: 'still syncing',
        syncStartedAt: new Date('2026-06-28T00:00:00.000Z'),
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

    await refreshInstallationRepositories(context, 12345);

    const [installation] = await testContext.db
      .select()
      .from(githubInstallation)
      .where(eq(githubInstallation.installationId, 12345));
    expect(installation.lastSyncedAt).toBeNull();
    expect(installation.syncStatus).toBe('in_progress');
    expect(installation.syncError).toBe('still syncing');
    expect(installation.syncStartedAt).toEqual(new Date('2026-06-28T00:00:00.000Z'));
    expect(installation.syncWorkflowExecutionToken).toBe('workflow-token');
    expect(installation.syncActivityAttemptToken).toBe('activity-token');
  });

  it('batches repository writes for large installations', async () => {
    expect.assertions(3);

    await testContext.factories.githubInstallation.create({
      installationId: 12345,
      accountLogin: 'test-org',
    });
    const repositories = Array.from({ length: 1_001 }, (_, index) => ({
      id: 10_000 + index,
      owner: { login: 'test-org' },
      name: `repository-${index}`,
      default_branch: 'main',
    }));
    const context = createGithubContext(testContext, repositories);

    const result = await refreshInstallationRepositories(context, 12345);

    expect(result).toEqual({ repositoryCount: 1_001, deactivatedRepositoryCount: 0 });
    const storedRepositories = await testContext.db.select().from(repository);
    expect(storedRepositories).toHaveLength(1_001);
    const storedLinks = await testContext.db.select().from(githubInstallationRepository);
    expect(storedLinks).toHaveLength(1_001);
  });

  it('throws when the GitHub App cannot construct an Octokit client for the installation', async () => {
    expect.assertions(1);

    await testContext.factories.githubInstallation.create({
      installationId: 12345,
      accountLogin: 'test-org',
    });
    const context = createGithubContext(testContext, []);
    context.getInstallationOctokit = vi.fn().mockResolvedValue(null);

    await expect(refreshInstallationRepositories(context, 12345)).rejects.toThrow(
      'Could not create GitHub client for installation 12345',
    );
  });

  it('throws ownership-lost when sync ownership is lost while paging through GitHub results', async () => {
    expect.assertions(1);

    await testContext.factories.githubInstallation.create({
      installationId: 12345,
      accountLogin: 'test-org',
    });
    await testContext.db
      .update(githubInstallation)
      .set({
        syncStatus: 'in_progress',
        syncWorkflowExecutionToken: 'current-workflow',
        syncActivityAttemptToken: 'current-attempt',
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
    // Clear the sync tokens as a side effect of the GitHub API call, so the
    // pre-flight ownership check (before paging) passes but the post-flight
    // check (after paging) observes the ownership loss -- exactly the race
    // the second check exists to guard against.
    context.getInstallationOctokit = vi.fn().mockResolvedValue({
      request: vi.fn(async () => {
        await testContext.db
          .update(githubInstallation)
          .set({ syncWorkflowExecutionToken: 'other-workflow' })
          .where(eq(githubInstallation.installationId, 12345));
        return { data: { repositories: [] } };
      }),
    });

    await expect(
      refreshInstallationRepositories(context, 12345, {
        syncWorkflowExecutionToken: 'current-workflow',
        syncActivityAttemptToken: 'current-attempt',
      }),
    ).rejects.toThrow('Installation sync ownership lost');
  });

  it('throws ownership-lost when a raw upsert batch returns no rows for a token-owned sync', async () => {
    expect.assertions(1);

    await testContext.factories.githubInstallation.create({
      installationId: 12345,
      accountLogin: 'test-org',
    });
    await testContext.db
      .update(githubInstallation)
      .set({
        syncStatus: 'in_progress',
        syncWorkflowExecutionToken: 'current-workflow',
        syncActivityAttemptToken: 'current-attempt',
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
    // Simulate a raw driver result that carries neither an array shape nor a
    // `.rows` property, forcing `getRows` down its empty-fallback path, and in
    // turn making the ownership assertion detect zero affected rows even
    // though the sync attempt still legitimately owns the installation.
    context.db = new Proxy(context.db, {
      get(target, property, receiver) {
        if (property === 'execute') {
          return async () => ({});
        }
        return Reflect.get(target, property, receiver);
      },
    }) as unknown as GithubServiceContext['db'];

    await expect(
      refreshInstallationRepositories(context, 12345, {
        syncWorkflowExecutionToken: 'current-workflow',
        syncActivityAttemptToken: 'current-attempt',
      }),
    ).rejects.toThrow('Installation sync ownership lost');
  });

  it('throws ownership-lost when the final settlement update affects no rows for a token-owned sync', async () => {
    expect.assertions(1);

    await testContext.factories.githubInstallation.create({
      installationId: 12345,
      accountLogin: 'test-org',
    });
    await testContext.db
      .update(githubInstallation)
      .set({
        syncStatus: 'in_progress',
        syncWorkflowExecutionToken: 'current-workflow',
        syncActivityAttemptToken: 'current-attempt',
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
    // Simulate the settlement UPDATE racing with a concurrent change to the
    // installation's sync tokens: everything up to settlement proceeds
    // normally against the real database, but the final `update(...).returning()`
    // resolves to zero rows, as it would if another process cleared the tokens
    // between the pre-flight ownership check and the settlement write.
    const realUpdate = context.db.update.bind(context.db);
    context.db = new Proxy(context.db, {
      get(target, property, receiver) {
        if (property === 'update') {
          return (table: unknown) => {
            if (table === githubInstallation) {
              return {
                set: () => ({
                  where: () => ({
                    returning: async () => [],
                  }),
                }),
              };
            }
            return realUpdate(table as never);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as unknown as GithubServiceContext['db'];

    await expect(
      refreshInstallationRepositories(context, 12345, {
        syncWorkflowExecutionToken: 'current-workflow',
        syncActivityAttemptToken: 'current-attempt',
      }),
    ).rejects.toThrow('Installation sync ownership lost');
  });
});

function makeRepositoryListItem(overrides: Partial<RepositoryListItem> = {}): RepositoryListItem {
  return {
    id: 1,
    name: 'widgets',
    full_name: 'acme/widgets',
    description: 'Widget factory',
    private: false,
    html_url: 'https://github.com/acme/widgets',
    language: 'TypeScript',
    stargazers_count: 10,
    forks_count: 2,
    open_issues_count: 1,
    default_branch: 'main',
    archived: false,
    fork: false,
    owner: { login: 'acme' } as RepositoryListItem['owner'],
    updated_at: '2026-01-02T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    pushed_at: '2026-01-03T00:00:00.000Z',
    installationId: 1,
    ...overrides,
  };
}

describe('parseFilters', () => {
  it('falls back to defaults when no search params are present', () => {
    const filters = parseFilters(new URL('https://example.com/repositories'));

    expect(filters).toEqual({
      query: '',
      visibility: 'all',
      sort: 'updated_at',
      direction: 'desc',
      language: '',
      archived: 'false',
      fork: 'all',
      owner: '',
      page: 1,
      perPage: 30,
    });
  });

  it('reads valid values from search params', () => {
    const url = new URL(
      'https://example.com/repositories?query=widgets&visibility=private&sort=name&direction=asc&language=TypeScript&archived=true&fork=false&owner=acme&page=3&per_page=50',
    );

    expect(parseFilters(url)).toEqual({
      query: 'widgets',
      visibility: 'private',
      sort: 'name',
      direction: 'asc',
      language: 'TypeScript',
      archived: 'true',
      fork: 'false',
      owner: 'acme',
      page: 3,
      perPage: 50,
    });
  });

  it('prefers the ownerParam argument over the owner search param', () => {
    const url = new URL('https://example.com/repositories?owner=from-query');

    expect(parseFilters(url, 'from-param').owner).toBe('from-param');
  });

  it('rejects invalid enum-like values and falls back to defaults', () => {
    const url = new URL(
      'https://example.com/repositories?visibility=bogus&sort=bogus&direction=bogus&archived=bogus&fork=bogus',
    );

    const filters = parseFilters(url);
    expect(filters.visibility).toBe('all');
    expect(filters.sort).toBe('updated_at');
    expect(filters.direction).toBe('desc');
    expect(filters.archived).toBe('false');
    expect(filters.fork).toBe('all');
  });

  it('clamps page to a minimum of 1 and per_page between 10 and 100', () => {
    const url = new URL('https://example.com/repositories?page=0&per_page=1000');
    expect(parseFilters(url).page).toBe(1);
    expect(parseFilters(url).perPage).toBe(100);

    const lowPerPage = new URL('https://example.com/repositories?per_page=1');
    expect(parseFilters(lowPerPage).perPage).toBe(10);

    const nonNumericPage = new URL('https://example.com/repositories?page=abc&per_page=abc');
    expect(parseFilters(nonNumericPage).page).toBe(1);
    expect(parseFilters(nonNumericPage).perPage).toBe(30);
  });
});

describe('filterRepositories', () => {
  const repositories = [
    makeRepositoryListItem({
      id: 1,
      name: 'widgets',
      full_name: 'acme/widgets',
      description: 'Widget factory',
      owner: { login: 'acme' } as RepositoryListItem['owner'],
      private: false,
      language: 'TypeScript',
      archived: false,
      fork: false,
    }),
    makeRepositoryListItem({
      id: 2,
      name: 'gadgets',
      full_name: 'other/gadgets',
      description: null,
      owner: { login: 'other' } as RepositoryListItem['owner'],
      private: true,
      language: 'Python',
      archived: true,
      fork: true,
    }),
  ];

  function filters(overrides: Partial<Parameters<typeof filterRepositories>[1]> = {}) {
    return {
      query: '',
      visibility: 'all' as const,
      sort: 'updated_at' as const,
      direction: 'desc' as const,
      language: '',
      archived: 'all' as const,
      fork: 'all' as const,
      owner: '',
      page: 1,
      perPage: 30,
      ...overrides,
    };
  }

  it('filters by owner case-insensitively', () => {
    expect(filterRepositories(repositories, filters({ owner: 'ACME' }))).toEqual([repositories[0]]);
  });

  it('filters by text query across name, full name, and description', () => {
    expect(filterRepositories(repositories, filters({ query: 'widget' }))).toEqual([
      repositories[0],
    ]);
    expect(filterRepositories(repositories, filters({ query: 'other/gadgets' }))).toEqual([
      repositories[1],
    ]);
    expect(filterRepositories(repositories, filters({ query: 'nonexistent' }))).toEqual([]);
  });

  it('excludes repositories whose description is null when searching', () => {
    expect(filterRepositories(repositories, filters({ query: 'factory' }))).toEqual([
      repositories[0],
    ]);
  });

  it('filters by visibility', () => {
    expect(filterRepositories(repositories, filters({ visibility: 'public' }))).toEqual([
      repositories[0],
    ]);
    expect(filterRepositories(repositories, filters({ visibility: 'private' }))).toEqual([
      repositories[1],
    ]);
  });

  it('filters by language case-insensitively', () => {
    expect(filterRepositories(repositories, filters({ language: 'python' }))).toEqual([
      repositories[1],
    ]);
  });

  it('filters by archived state', () => {
    expect(filterRepositories(repositories, filters({ archived: 'true' }))).toEqual([
      repositories[1],
    ]);
    expect(filterRepositories(repositories, filters({ archived: 'false' }))).toEqual([
      repositories[0],
    ]);
  });

  it('filters by fork state', () => {
    expect(filterRepositories(repositories, filters({ fork: 'true' }))).toEqual([repositories[1]]);
    expect(filterRepositories(repositories, filters({ fork: 'false' }))).toEqual([repositories[0]]);
  });

  it('returns all repositories when no filters are set', () => {
    expect(filterRepositories(repositories, filters())).toEqual(repositories);
  });
});

describe('sortRepositories', () => {
  const repositories = [
    makeRepositoryListItem({
      id: 1,
      name: 'b-repo',
      updated_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      pushed_at: null,
      stargazers_count: 5,
      open_issues_count: 3,
    }),
    makeRepositoryListItem({
      id: 2,
      name: 'a-repo',
      updated_at: null,
      created_at: null,
      pushed_at: '2026-01-05T00:00:00.000Z',
      stargazers_count: 10,
      open_issues_count: 1,
    }),
  ];

  it('sorts by name ascending and descending', () => {
    expect(sortRepositories(repositories, 'name', 'asc').map((r) => r.name)).toEqual([
      'a-repo',
      'b-repo',
    ]);
    expect(sortRepositories(repositories, 'name', 'desc').map((r) => r.name)).toEqual([
      'b-repo',
      'a-repo',
    ]);
  });

  it('sorts by updated_at, treating a null timestamp as epoch', () => {
    expect(sortRepositories(repositories, 'updated_at', 'asc').map((r) => r.id)).toEqual([2, 1]);
  });

  it('sorts by created_at, treating a null timestamp as epoch', () => {
    expect(sortRepositories(repositories, 'created_at', 'asc').map((r) => r.id)).toEqual([2, 1]);
  });

  it('sorts by pushed_at, treating a null timestamp as epoch', () => {
    expect(sortRepositories(repositories, 'pushed_at', 'asc').map((r) => r.id)).toEqual([1, 2]);
  });

  it('sorts by stargazers_count', () => {
    expect(sortRepositories(repositories, 'stargazers_count', 'asc').map((r) => r.id)).toEqual([
      1, 2,
    ]);
  });

  it('sorts by open_issues_count', () => {
    expect(sortRepositories(repositories, 'open_issues_count', 'asc').map((r) => r.id)).toEqual([
      2, 1,
    ]);
  });

  it('does not mutate the input array', () => {
    const original = [...repositories];
    sortRepositories(repositories, 'name', 'asc');
    expect(repositories).toEqual(original);
  });
});

describe('paginateRepositories', () => {
  const repositories = Array.from({ length: 25 }, (_, index) =>
    makeRepositoryListItem({ id: index + 1, name: `repo-${index + 1}` }),
  );

  it('slices the requested page', () => {
    const result = paginateRepositories(repositories, 2, 10);
    expect(result.items.map((r) => r.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(result.total).toBe(25);
    expect(result.page).toBe(2);
    expect(result.perPage).toBe(10);
    expect(result.totalPages).toBe(3);
  });

  it('returns an empty page past the end of the list', () => {
    const result = paginateRepositories(repositories, 10, 10);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(3);
  });
});

describe('getRepositoryById', () => {
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

  it('returns the repository row when it exists', async () => {
    await testContext.factories.repository.create({ id: 500, owner: 'acme', name: 'widgets' });
    const context = createGithubContext(testContext, []);

    const repo = await getRepositoryById(context, 500);

    expect(repo?.owner).toBe('acme');
    expect(repo?.name).toBe('widgets');
  });

  it('returns null when the repository does not exist', async () => {
    const context = createGithubContext(testContext, []);

    expect(await getRepositoryById(context, 999_999)).toBeNull();
  });
});

describe('getRepositoryByOwnerAndName', () => {
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

  it('matches case-insensitively and returns the row', async () => {
    await testContext.factories.repository.create({ id: 501, owner: 'acme', name: 'widgets' });
    const context = createGithubContext(testContext, []);

    const repo = await getRepositoryByOwnerAndName(context, 'ACME', 'WIDGETS');

    expect(repo?.id).toBe(501);
  });

  it('returns null when no repository matches', async () => {
    const context = createGithubContext(testContext, []);

    expect(await getRepositoryByOwnerAndName(context, 'nobody', 'nothing')).toBeNull();
  });
});

describe('getOrCreateRepository', () => {
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

  it('creates a repository row when none exists', async () => {
    const context = createGithubContext(testContext, []);

    const repo = await getOrCreateRepository(context, 502, 'acme', 'widgets', 12345);

    expect(repo.id).toBe(502);
    expect(repo.owner).toBe('acme');
    expect(repo.name).toBe('widgets');
    expect(repo.uri).toBe('https://github.com/acme/widgets.git');
    expect(repo.installationId).toBe(12345);
  });

  it('updates the existing row on conflict', async () => {
    await testContext.factories.repository.create({
      id: 502,
      owner: 'old-owner',
      name: 'old-name',
      installationId: 1,
    });
    const context = createGithubContext(testContext, []);

    const repo = await getOrCreateRepository(context, 502, 'acme', 'widgets', 12345);

    expect(repo.owner).toBe('acme');
    expect(repo.name).toBe('widgets');
    expect(repo.installationId).toBe(12345);
  });
});

describe('getRepositoryIdsByOwner', () => {
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

  it('returns the IDs of repositories owned by the given login', async () => {
    await testContext.factories.repository.create({ id: 601, owner: 'acme', name: 'widgets' });
    await testContext.factories.repository.create({ id: 602, owner: 'acme', name: 'gadgets' });
    await testContext.factories.repository.create({ id: 603, owner: 'other', name: 'thing' });
    const context = createGithubContext(testContext, []);

    const ids = await getRepositoryIdsByOwner(context, 'acme');

    expect(ids.sort()).toEqual([601, 602]);
  });

  it('returns an empty array when the owner has no repositories', async () => {
    const context = createGithubContext(testContext, []);

    expect(await getRepositoryIdsByOwner(context, 'nobody')).toEqual([]);
  });
});

describe('updateRepositoryMetadata', () => {
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

  it('updates owner, name, uri, and installationId', async () => {
    await testContext.factories.repository.create({
      id: 700,
      owner: 'old-owner',
      name: 'old-name',
      installationId: 1,
    });
    const context = createGithubContext(testContext, []);

    await updateRepositoryMetadata(context, 700, 'new-owner', 'new-name', 999);

    const [repo] = await testContext.db.select().from(repository).where(eq(repository.id, 700));
    expect(repo.owner).toBe('new-owner');
    expect(repo.name).toBe('new-name');
    expect(repo.uri).toBe('https://github.com/new-owner/new-name.git');
    expect(repo.installationId).toBe(999);
  });
});

describe('updateRepositoryDefaultBranch', () => {
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

  it('updates the default branch and resets commit to null', async () => {
    await testContext.factories.repository.create({
      id: 701,
      owner: 'acme',
      name: 'widgets',
      defaultBranch: 'master',
      commit: 'deadbeef',
    });
    const context = createGithubContext(testContext, []);

    await updateRepositoryDefaultBranch(context, 701, 'main');

    const [repo] = await testContext.db.select().from(repository).where(eq(repository.id, 701));
    expect(repo.defaultBranch).toBe('main');
    expect(repo.commit).toBeNull();
  });
});

describe('updateRepositoryCommit', () => {
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

  it('updates the commit SHA', async () => {
    await testContext.factories.repository.create({
      id: 702,
      owner: 'acme',
      name: 'widgets',
      commit: null,
    });
    const context = createGithubContext(testContext, []);

    await updateRepositoryCommit(context, 702, 'cafebabe');

    const [repo] = await testContext.db.select().from(repository).where(eq(repository.id, 702));
    expect(repo.commit).toBe('cafebabe');
  });
});

describe('getInstallationForRepository', () => {
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

  it('returns not_found when the repository does not exist', async () => {
    const context = createGithubContext(testContext, []);

    const result = await getInstallationForRepository(context, 999_999);

    expect(result).toEqual({ ok: false, error: 'Repository not found', code: 'not_found' });
  });

  it('returns no_installation when the repository has no installation link or column', async () => {
    await testContext.factories.repository.create({
      id: 800,
      owner: 'acme',
      name: 'widgets',
      installationId: null,
    });
    const context = createGithubContext(testContext, []);

    const result = await getInstallationForRepository(context, 800);

    expect(result).toEqual({
      ok: false,
      error: 'Repository has no associated GitHub installation',
      code: 'no_installation',
    });
  });

  it('returns no_installation when the linked installation record is missing', async () => {
    await testContext.factories.repository.create({
      id: 801,
      owner: 'acme',
      name: 'widgets',
      installationId: 424_242,
    });
    const context = createGithubContext(testContext, []);

    const result = await getInstallationForRepository(context, 801);

    expect(result).toEqual({
      ok: false,
      error: 'GitHub installation not found',
      code: 'no_installation',
    });
  });

  it('returns suspended when the installation is suspended', async () => {
    await testContext.factories.githubInstallation.create({
      installationId: 802,
      accountLogin: 'acme',
      status: 'suspended',
    });
    await testContext.factories.repository.create({
      id: 802,
      owner: 'acme',
      name: 'widgets',
      installationId: 802,
    });
    const context = createGithubContext(testContext, []);

    const result = await getInstallationForRepository(context, 802);

    expect(result).toEqual({
      ok: false,
      error: 'GitHub installation is suspended',
      code: 'suspended',
    });
  });

  it('returns error when the installation status is neither active nor suspended', async () => {
    await testContext.factories.githubInstallation.create({
      installationId: 803,
      accountLogin: 'acme',
      status: 'needs_permissions',
    });
    await testContext.factories.repository.create({
      id: 803,
      owner: 'acme',
      name: 'widgets',
      installationId: 803,
    });
    const context = createGithubContext(testContext, []);

    const result = await getInstallationForRepository(context, 803);

    expect(result).toEqual({
      ok: false,
      error: 'GitHub installation is needs_permissions',
      code: 'error',
    });
  });

  it('returns error when the Octokit client cannot be constructed', async () => {
    await testContext.factories.githubInstallation.create({
      installationId: 804,
      accountLogin: 'acme',
      status: 'active',
    });
    await testContext.factories.repository.create({
      id: 804,
      owner: 'acme',
      name: 'widgets',
      installationId: 804,
    });
    const context = createGithubContext(testContext, []);
    context.getInstallationOctokit = vi.fn().mockResolvedValue(null);

    const result = await getInstallationForRepository(context, 804);

    expect(result).toEqual({
      ok: false,
      error: 'Failed to create GitHub client - check app configuration',
      code: 'error',
    });
  });

  it('resolves an installation ID preferring the active link table entry', async () => {
    await testContext.factories.githubInstallation.create({
      installationId: 805,
      accountLogin: 'acme',
      status: 'active',
    });
    await testContext.factories.repository.create({
      id: 805,
      owner: 'acme',
      name: 'widgets',
      installationId: 111_111,
    });
    await testContext.db.insert(githubInstallationRepository).values({
      installationId: 805,
      repositoryId: 805,
      isActive: true,
    });
    const context = createGithubContext(testContext, []);

    const result = await getInstallationForRepository(context, 805);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.installationId).toBe(805);
      expect(result.owner).toBe('acme');
      expect(result.repo).toBe('widgets');
      expect(result.octokit).toBeDefined();
    }
  });
});

describe('getInstallationIdForRepository', () => {
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

  it('uses knownInstallationId and skips the repository query when the installation exists', async () => {
    await testContext.factories.githubInstallation.create({
      installationId: 900,
      accountLogin: 'acme',
      status: 'active',
    });
    const context = createGithubContext(testContext, []);

    const result = await getInstallationIdForRepository(context, 999_999, 900);

    expect(result).toEqual({ ok: true, installationId: 900 });
  });

  it('returns not_found when knownInstallationId is omitted and the repository does not exist', async () => {
    const context = createGithubContext(testContext, []);

    const result = await getInstallationIdForRepository(context, 999_999);

    expect(result).toEqual({ ok: false, error: 'Repository not found', code: 'not_found' });
  });

  it('prefers the active link table entry over the repository column', async () => {
    await testContext.factories.githubInstallation.create({
      installationId: 901,
      accountLogin: 'acme',
      status: 'active',
    });
    await testContext.factories.repository.create({
      id: 901,
      owner: 'acme',
      name: 'widgets',
      installationId: 222_222,
    });
    await testContext.db.insert(githubInstallationRepository).values({
      installationId: 901,
      repositoryId: 901,
      isActive: true,
    });
    const context = createGithubContext(testContext, []);

    const result = await getInstallationIdForRepository(context, 901);

    expect(result).toEqual({ ok: true, installationId: 901 });
  });

  it('falls back to the repository column when there is no active link', async () => {
    await testContext.factories.githubInstallation.create({
      installationId: 902,
      accountLogin: 'acme',
      status: 'active',
    });
    await testContext.factories.repository.create({
      id: 902,
      owner: 'acme',
      name: 'widgets',
      installationId: 902,
    });
    const context = createGithubContext(testContext, []);

    const result = await getInstallationIdForRepository(context, 902);

    expect(result).toEqual({ ok: true, installationId: 902 });
  });

  it('returns no_installation when neither the link table nor the column resolve an installation', async () => {
    await testContext.factories.repository.create({
      id: 903,
      owner: 'acme',
      name: 'widgets',
      installationId: null,
    });
    const context = createGithubContext(testContext, []);

    const result = await getInstallationIdForRepository(context, 903);

    expect(result).toEqual({
      ok: false,
      error: 'Repository has no associated GitHub installation',
      code: 'no_installation',
    });
  });

  it('returns no_installation when the resolved installation record does not exist', async () => {
    await testContext.factories.repository.create({
      id: 904,
      owner: 'acme',
      name: 'widgets',
      installationId: 333_333,
    });
    const context = createGithubContext(testContext, []);

    const result = await getInstallationIdForRepository(context, 904);

    expect(result).toEqual({
      ok: false,
      error: 'GitHub installation not found',
      code: 'no_installation',
    });
  });

  it('does not reject a suspended installation, unlike getInstallationForRepository', async () => {
    await testContext.factories.githubInstallation.create({
      installationId: 905,
      accountLogin: 'acme',
      status: 'suspended',
    });
    await testContext.factories.repository.create({
      id: 905,
      owner: 'acme',
      name: 'widgets',
      installationId: 905,
    });
    const context = createGithubContext(testContext, []);

    const result = await getInstallationIdForRepository(context, 905);

    expect(result).toEqual({ ok: true, installationId: 905 });
  });
});

describe('markInstallationRepositoryInactive', () => {
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

  it('marks an existing link inactive and stamps removedAt', async () => {
    await testContext.factories.githubInstallation.create({
      installationId: 1000,
      accountLogin: 'acme',
    });
    await testContext.factories.repository.create({
      id: 1000,
      owner: 'acme',
      name: 'widgets',
    });
    await testContext.db.insert(githubInstallationRepository).values({
      installationId: 1000,
      repositoryId: 1000,
      isActive: true,
    });
    const context = createGithubContext(testContext, []);

    await markInstallationRepositoryInactive(context, 1000, 1000);

    const [link] = await testContext.db
      .select()
      .from(githubInstallationRepository)
      .where(eq(githubInstallationRepository.repositoryId, 1000));
    expect(link.isActive).toBe(false);
    expect(link.removedAt).toBeInstanceOf(Date);
  });

  it('is a no-op when no matching link row exists', async () => {
    const context = createGithubContext(testContext, []);

    await expect(markInstallationRepositoryInactive(context, 9999, 9999)).resolves.toBeUndefined();
  });
});
