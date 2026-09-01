import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { pullRequestReviewRun, repository, tribunalRun, user } from '@tribunal/database/schema';
import { runWithDatabase } from '$lib/server/database';
import { getReviewRun, listReviewRuns } from './review-run-reader';

describe('review run reader', () => {
  let testDb: TestDatabase;
  let ownerId: number;
  let otherUserId: number;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
    const [owner] = await testDb.db.insert(user).values({ username: 'owner' }).returning();
    const [other] = await testDb.db.insert(user).values({ username: 'other' }).returning();
    ownerId = owner.id;
    otherUserId = other.id;
    await testDb.db.insert(repository).values([
      { id: 9001, owner: 'lost-gradient', name: 'tribunal', defaultBranch: 'main' },
      { id: 9002, owner: 'lost-gradient', name: 'cinder', defaultBranch: 'main' },
    ]);
  });

  function withTestDatabase<T>(operation: () => Promise<T>): Promise<T> {
    return runWithDatabase(testDb.db as never, operation);
  }

  async function insertRun(input: {
    id: string;
    userId: number;
    repositoryId?: number;
    prNumber?: number;
    status?: string;
    startedAt?: Date;
    finishedAt?: Date;
    costEstimateUsd?: string;
    error?: string;
  }) {
    await testDb.db.insert(tribunalRun).values({
      id: input.id,
      userId: input.userId,
      repositoryId: input.repositoryId ?? 9001,
      runKind: 'pull_request_review',
      status: input.status ?? 'posted',
      workflowId: 'workflow-secret',
      sandboxId: 'sandbox-secret',
      costEstimateUsd: input.costEstimateUsd ?? '1.25',
      startedAt: input.startedAt ?? new Date('2026-08-01T00:00:00.000Z'),
      finishedAt: input.finishedAt ?? new Date('2026-08-01T00:05:00.000Z'),
      error: input.error,
    });
    await testDb.db.insert(pullRequestReviewRun).values({
      runId: input.id,
      userId: input.userId,
      repositoryId: input.repositoryId ?? 9001,
      // Distinct per run: the table is uniquely indexed on
      // (user, repository, pull request, head sha, trigger), so seeding two
      // runs with identical defaults collides rather than testing anything.
      prNumber: input.prNumber ?? 7,
      headSha: `sha-${input.id}`,
      trigger: 'opened',
      commentsPosted: 2,
    });
  }

  it('projects a run to its lifecycle fields alone', async () => {
    expect.assertions(2);
    await insertRun({ id: 'run-1', userId: ownerId, error: 'internal failure detail' });

    const run = await withTestDatabase(() => getReviewRun(ownerId, 'run-1'));

    expect(run).toEqual({
      id: 'run-1',
      status: 'posted',
      repositoryId: 9001,
      repositoryOwner: 'lost-gradient',
      repositoryName: 'tribunal',
      pullRequestNumber: 7,
      trigger: 'opened',
      headSha: 'sha-run-1',
      costEstimateUsd: 1.25,
      commentsPosted: 2,
      startedAt: '2026-08-01T00:00:00.000Z',
      finishedAt: '2026-08-01T00:05:00.000Z',
    });
    expect(JSON.stringify(run)).not.toMatch(/secret|internal failure/);
  });

  it("refuses another account's run rather than reporting it", async () => {
    expect.assertions(1);
    await insertRun({ id: 'run-1', userId: otherUserId });

    const run = await withTestDatabase(() => getReviewRun(ownerId, 'run-1'));

    expect(run).toBeNull();
  });

  it('returns null for a run that does not exist', async () => {
    expect.assertions(1);

    const run = await withTestDatabase(() => getReviewRun(ownerId, 'missing'));

    expect(run).toBeNull();
  });

  it('lists only the caller own runs, newest first', async () => {
    expect.assertions(1);
    await insertRun({
      id: 'run-old',
      userId: ownerId,
      startedAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    await insertRun({
      id: 'run-new',
      userId: ownerId,
      startedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await insertRun({ id: 'run-theirs', userId: otherUserId });

    const page = await withTestDatabase(() => listReviewRuns(ownerId, { limit: 25, offset: 0 }));

    expect(page.items.map((run) => run.id)).toEqual(['run-new', 'run-old']);
  });

  it('reports that a further page exists rather than truncating silently', async () => {
    expect.assertions(3);
    await insertRun({
      id: 'run-a',
      userId: ownerId,
      startedAt: new Date('2026-08-03T00:00:00.000Z'),
    });
    await insertRun({
      id: 'run-b',
      userId: ownerId,
      startedAt: new Date('2026-08-02T00:00:00.000Z'),
    });
    await insertRun({
      id: 'run-c',
      userId: ownerId,
      startedAt: new Date('2026-08-01T00:00:00.000Z'),
    });

    const firstPage = await withTestDatabase(() =>
      listReviewRuns(ownerId, { limit: 2, offset: 0 }),
    );
    const secondPage = await withTestDatabase(() =>
      listReviewRuns(ownerId, { limit: 2, offset: 2 }),
    );

    expect(firstPage.items.map((run) => run.id)).toEqual(['run-a', 'run-b']);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage).toMatchObject({ hasMore: false, offset: 2 });
  });

  it('restricts the list to one repository when asked', async () => {
    expect.assertions(1);
    await insertRun({ id: 'run-tribunal', userId: ownerId, repositoryId: 9001 });
    await insertRun({ id: 'run-cinder', userId: ownerId, repositoryId: 9002 });

    const page = await withTestDatabase(() =>
      listReviewRuns(ownerId, { limit: 25, offset: 0, repositoryId: 9002 }),
    );

    expect(page.items.map((run) => run.id)).toEqual(['run-cinder']);
  });

  it('reports a run that has not started yet', async () => {
    expect.assertions(1);
    await testDb.db.insert(tribunalRun).values({
      id: 'run-queued',
      userId: ownerId,
      repositoryId: 9001,
      runKind: 'pull_request_review',
      status: 'queued',
    });
    await testDb.db.insert(pullRequestReviewRun).values({
      runId: 'run-queued',
      userId: ownerId,
      repositoryId: 9001,
      prNumber: 11,
      headSha: 'def456',
      trigger: 'manual',
    });

    const run = await withTestDatabase(() => getReviewRun(ownerId, 'run-queued'));

    expect(run).toMatchObject({ status: 'queued', startedAt: null, finishedAt: null });
  });
});
