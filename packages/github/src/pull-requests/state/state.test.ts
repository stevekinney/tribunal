import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import { pullRequestState } from '@tribunal/database/schema';
import type { GithubServiceContext } from '../../context.js';
import {
  getPRState,
  listPRStates,
  listPRStatesForRepositories,
  setIsPaused,
  upsertPRState,
} from './state.js';

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

function createGithubContext(): GithubServiceContext {
  return {
    db: testContext.db as unknown as GithubServiceContext['db'],
    cache: {} as GithubServiceContext['cache'],
    getInstallationOctokit: vi.fn(),
  };
}

async function createRepository(id: number) {
  return testContext.factories.repository.create({ id });
}

describe('upsertPRState', () => {
  it('inserts a new PR state row', async () => {
    const repository = await createRepository(9001);
    const context = createGithubContext();

    const result = await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 1,
      state: 'open',
      isDraft: false,
      isMerged: false,
      headSha: 'abc123',
      baseSha: 'def456',
      baseRef: 'main',
      prUpdatedAt: new Date('2024-01-01T00:00:00Z'),
    });

    expect(result).toMatchObject({
      repositoryId: repository.id,
      prNumber: 1,
      state: 'open',
      headSha: 'abc123',
    });
  });

  it('updates PR metadata when the event timestamp is newer than the stored prUpdatedAt', async () => {
    const repository = await createRepository(9002);
    const context = createGithubContext();

    await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 1,
      state: 'open',
      headSha: 'first-sha',
      prUpdatedAt: new Date('2024-01-01T00:00:00Z'),
    });

    const updated = await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 1,
      state: 'closed',
      isMerged: true,
      headSha: 'second-sha',
      prUpdatedAt: new Date('2024-01-02T00:00:00Z'),
    });

    expect(updated.state).toBe('closed');
    expect(updated.isMerged).toBe(true);
    expect(updated.headSha).toBe('second-sha');
  });

  it('rejects a stale update: an older prUpdatedAt does not overwrite newer stored PR metadata', async () => {
    const repository = await createRepository(9003);
    const context = createGithubContext();

    await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 1,
      state: 'open',
      headSha: 'latest-sha',
      prUpdatedAt: new Date('2024-01-05T00:00:00Z'),
    });

    const staleUpdate = await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 1,
      state: 'closed',
      headSha: 'stale-sha',
      prUpdatedAt: new Date('2024-01-01T00:00:00Z'),
    });

    expect(staleUpdate.state).toBe('open');
    expect(staleUpdate.headSha).toBe('latest-sha');
  });

  it('updates the CI, review, and merge sections independently of PR metadata timestamps', async () => {
    const repository = await createRepository(9004);
    const context = createGithubContext();

    await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 1,
      state: 'open',
    });

    const updated = await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 1,
      ciStatus: 'failing',
      failingCheckCount: 2,
      ciUpdatedAt: new Date('2024-01-01T00:00:00Z'),
      reviewStatus: 'approved',
      approvalCount: 1,
      changesRequestedCount: 0,
      unresolvedThreadCount: 0,
      reviewUpdatedAt: new Date('2024-01-01T00:00:00Z'),
      mergeStatus: 'clean',
      mergeUpdatedAt: new Date('2024-01-01T00:00:00Z'),
    });

    expect(updated.ciStatus).toBe('failing');
    expect(updated.failingCheckCount).toBe(2);
    expect(updated.reviewStatus).toBe('approved');
    expect(updated.mergeStatus).toBe('clean');
  });

  it('sets a field directly (without a *UpdatedAt guard) when no section timestamp is supplied', async () => {
    const repository = await createRepository(9005);
    const context = createGithubContext();

    await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 1,
      state: 'open',
    });

    const updated = await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 1,
      isDraft: true,
      isMerged: false,
      headSha: 'no-timestamp-sha',
      baseSha: 'base-sha',
      baseRef: 'develop',
      ciStatus: 'passing',
      failingCheckCount: 0,
      reviewStatus: 'pending',
      approvalCount: 0,
      changesRequestedCount: 0,
      unresolvedThreadCount: 0,
      mergeStatus: 'behind',
    });

    expect(updated.isDraft).toBe(true);
    expect(updated.headSha).toBe('no-timestamp-sha');
    expect(updated.ciStatus).toBe('passing');
    expect(updated.mergeStatus).toBe('behind');
  });
});

describe('getPRState', () => {
  it('delegates to the canonical database query implementation', async () => {
    const repository = await createRepository(9006);
    const context = createGithubContext();
    await upsertPRState(context, { repositoryId: repository.id, prNumber: 1, state: 'open' });

    const found = await getPRState(context, repository.id, 1);
    const notFound = await getPRState(context, repository.id, 999);

    expect(found?.prNumber).toBe(1);
    expect(notFound).toBeNull();
  });
});

describe('listPRStates', () => {
  it('lists PR states for a repository, applying filters and a cursor', async () => {
    const repository = await createRepository(9007);
    const context = createGithubContext();
    await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 1,
      state: 'open',
      ciStatus: 'passing',
      isPaused: false,
    });
    await upsertPRState(context, {
      repositoryId: repository.id,
      prNumber: 2,
      state: 'open',
      ciStatus: 'failing',
      isPaused: true,
      automationStatus: 'running',
    });

    const all = await listPRStates(context, repository.id);
    expect(all).toHaveLength(2);

    const filteredByCi = await listPRStates(context, repository.id, { ciStatus: 'failing' });
    expect(filteredByCi.map((row) => row.prNumber)).toEqual([2]);

    const filteredByAutomation = await listPRStates(context, repository.id, {
      automationStatus: 'running',
    });
    expect(filteredByAutomation.map((row) => row.prNumber)).toEqual([2]);

    const filteredByPaused = await listPRStates(context, repository.id, { isPaused: true });
    expect(filteredByPaused.map((row) => row.prNumber)).toEqual([2]);

    const afterCursor = await listPRStates(context, repository.id, undefined, 50, all[0]!.id);
    expect(afterCursor.map((row) => row.prNumber)).toEqual([2]);
  });
});

describe('listPRStatesForRepositories', () => {
  it('returns an empty map without querying when given no PRs', async () => {
    const context = createGithubContext();

    const result = await listPRStatesForRepositories(context, []);

    expect(result).toEqual(new Map());
  });

  it('returns a map keyed by repositoryId:prNumber for the requested PRs only', async () => {
    const repositoryA = await createRepository(9008);
    const repositoryB = await createRepository(9009);
    const context = createGithubContext();
    await upsertPRState(context, { repositoryId: repositoryA.id, prNumber: 1, state: 'open' });
    await upsertPRState(context, { repositoryId: repositoryA.id, prNumber: 2, state: 'open' });
    await upsertPRState(context, { repositoryId: repositoryB.id, prNumber: 1, state: 'open' });

    const result = await listPRStatesForRepositories(context, [
      { repositoryId: repositoryA.id, prNumber: 1 },
      { repositoryId: repositoryB.id, prNumber: 1 },
    ]);

    expect(result.size).toBe(2);
    expect(result.get(`${repositoryA.id}:1`)?.prNumber).toBe(1);
    expect(result.get(`${repositoryB.id}:1`)?.prNumber).toBe(1);
    expect(result.has(`${repositoryA.id}:2`)).toBe(false);
  });
});

describe('setIsPaused', () => {
  it('updates isPaused and returns the row when it exists', async () => {
    const repository = await createRepository(9010);
    const context = createGithubContext();
    await upsertPRState(context, { repositoryId: repository.id, prNumber: 1, state: 'open' });

    const result = await setIsPaused(context, repository.id, 1, true);

    expect(result?.isPaused).toBe(true);

    const [row] = await testContext.db
      .select()
      .from(pullRequestState)
      .where(eq(pullRequestState.prNumber, 1));
    expect(row?.isPaused).toBe(true);
  });

  it('returns null when no matching PR state exists', async () => {
    const repository = await createRepository(9011);
    const context = createGithubContext();

    const result = await setIsPaused(context, repository.id, 999, true);

    expect(result).toBeNull();
  });
});
