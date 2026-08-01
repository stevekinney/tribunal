import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import type { Database } from '@tribunal/database';
import { pullRequestActionItemSource } from '@tribunal/database/schema';
import type { GithubServiceContext } from '../../context.js';
import { upsertPRState } from '../state/state.js';
import { addActionItemSources, upsertActionItems } from './repository.js';

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

/** `repository.ts`'s functions take a `Database` directly (not a `GithubServiceContext`). */
function db(): Database {
  return testContext.db as unknown as Database;
}

async function createPullRequestState(prNumber = 1) {
  const repository = await testContext.factories.repository.create({ id: 6000 + prNumber });
  const context = createGithubContext();
  return upsertPRState(context, { repositoryId: repository.id, prNumber, state: 'open' });
}

describe('upsertActionItems', () => {
  it('returns an empty array without querying when given no items', async () => {
    const result = await upsertActionItems(db(), 1, []);

    expect(result).toEqual([]);
  });

  it('inserts new action items for a PR state', async () => {
    const prState = await createPullRequestState(1);

    const items = await upsertActionItems(db(), prState.id, [
      { stableKey: 'thread-1' },
      { stableKey: 'thread-2' },
    ]);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.stableKey).sort()).toEqual(['thread-1', 'thread-2']);
  });

  it('backfills firstSeenHeadSha on conflict via COALESCE', async () => {
    const prState = await createPullRequestState(2);
    const [first] = await upsertActionItems(db(), prState.id, [{ stableKey: 'thread-1' }]);
    expect(first!.firstSeenHeadSha).toBeNull();

    const [updatedWithSha] = await upsertActionItems(db(), prState.id, [
      {
        stableKey: 'thread-1',
        firstSeenHeadSha: 'sha-1',
      },
    ]);
    expect(updatedWithSha!.firstSeenHeadSha).toBe('sha-1');

    // A later upsert with a different firstSeenHeadSha must not overwrite the
    // one already recorded -- "first seen" semantics.
    const [preserved] = await upsertActionItems(db(), prState.id, [
      {
        stableKey: 'thread-1',
        firstSeenHeadSha: 'sha-2',
      },
    ]);
    expect(preserved!.firstSeenHeadSha).toBe('sha-1');
  });
});

describe('addActionItemSources', () => {
  it('does nothing when given no sources', async () => {
    await expect(addActionItemSources(db(), 1, [])).resolves.toBeUndefined();
  });

  it('appends sources to an action item and deduplicates on conflict', async () => {
    const prState = await createPullRequestState(3);
    const [item] = await upsertActionItems(db(), prState.id, [{ stableKey: 'thread-1' }]);

    await addActionItemSources(db(), item!.id, [
      { sourceType: 'review_comment', sourceIdentifier: 'comment-1' },
    ]);
    // A duplicate (same actionItemId, sourceType, sourceIdentifier) is
    // silently skipped -- sources are append-only, never overwritten.
    await addActionItemSources(db(), item!.id, [
      {
        sourceType: 'review_comment',
        sourceIdentifier: 'comment-1',
      },
      { sourceType: 'issue_comment', sourceIdentifier: 'comment-2' },
    ]);

    const sources = await db()
      .select()
      .from(pullRequestActionItemSource)
      .where(eq(pullRequestActionItemSource.actionItemId, item!.id))
      .orderBy(
        pullRequestActionItemSource.sourceType,
        pullRequestActionItemSource.sourceIdentifier,
      );

    expect(sources).toHaveLength(2);
    const reviewCommentSource = sources.find((source) => source.sourceType === 'review_comment');
    expect(reviewCommentSource?.sourceIdentifier).toBe('comment-1');
  });
});
