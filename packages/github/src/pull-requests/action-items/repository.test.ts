import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import type { Database } from '@tribunal/database';
import type { GithubServiceContext } from '../../context.js';
import { upsertPRState } from '../state/state.js';
import {
  addActionItemSources,
  countActionItemsByStatus,
  getActionItem,
  listActionItems,
  listActionItemsWithMetadata,
  upsertActionItems,
} from './repository.js';

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
      { stableKey: 'thread-1', subject: 'Fix the bug', status: 'pending' },
      {
        stableKey: 'thread-2',
        subject: 'Add a test',
        description: 'Cover the edge case',
        status: 'done',
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.stableKey).sort()).toEqual(['thread-1', 'thread-2']);
  });

  it('updates subject/description/status on conflict and backfills firstSeenHeadSha via COALESCE', async () => {
    const prState = await createPullRequestState(2);
    const [first] = await upsertActionItems(db(), prState.id, [
      { stableKey: 'thread-1', subject: 'Original subject', status: 'pending' },
    ]);
    expect(first!.firstSeenHeadSha).toBeNull();

    const [updatedWithSha] = await upsertActionItems(db(), prState.id, [
      {
        stableKey: 'thread-1',
        subject: 'Updated subject',
        status: 'in_progress',
        firstSeenHeadSha: 'sha-1',
      },
    ]);
    expect(updatedWithSha!.subject).toBe('Updated subject');
    expect(updatedWithSha!.status).toBe('in_progress');
    expect(updatedWithSha!.firstSeenHeadSha).toBe('sha-1');

    // A later upsert with a different firstSeenHeadSha must not overwrite the
    // one already recorded -- "first seen" semantics.
    const [preserved] = await upsertActionItems(db(), prState.id, [
      {
        stableKey: 'thread-1',
        subject: 'Updated again',
        status: 'done',
        firstSeenHeadSha: 'sha-2',
      },
    ]);
    expect(preserved!.firstSeenHeadSha).toBe('sha-1');
    expect(preserved!.status).toBe('done');
  });
});

describe('addActionItemSources', () => {
  it('does nothing when given no sources', async () => {
    await expect(addActionItemSources(db(), 1, [])).resolves.toBeUndefined();
  });

  it('appends sources to an action item and deduplicates on conflict', async () => {
    const prState = await createPullRequestState(3);
    const [item] = await upsertActionItems(db(), prState.id, [
      { stableKey: 'thread-1', subject: 'Fix the bug', status: 'pending' },
    ]);

    await addActionItemSources(db(), item!.id, [
      { sourceType: 'review_comment', sourceIdentifier: 'comment-1', sourceUrl: 'https://x/1' },
    ]);
    // A duplicate (same actionItemId, sourceType, sourceIdentifier) is
    // silently skipped -- sources are append-only, never overwritten.
    await addActionItemSources(db(), item!.id, [
      {
        sourceType: 'review_comment',
        sourceIdentifier: 'comment-1',
        sourceUrl: 'https://x/1-changed',
      },
      { sourceType: 'issue_comment', sourceIdentifier: 'comment-2' },
    ]);

    const withMetadata = await listActionItemsWithMetadata(db(), prState.id);
    expect(withMetadata[0]!.sources).toHaveLength(2);
    const reviewCommentSource = withMetadata[0]!.sources.find(
      (source) => source.sourceType === 'review_comment',
    );
    expect(reviewCommentSource?.sourceUrl).toBe('https://x/1');
  });
});

describe('listActionItems', () => {
  it('lists action items for a PR state, filtered by status and paginated by cursor', async () => {
    const prState = await createPullRequestState(4);
    await upsertActionItems(db(), prState.id, [
      { stableKey: 'thread-1', subject: 'A', status: 'pending' },
      { stableKey: 'thread-2', subject: 'B', status: 'done' },
    ]);

    const all = await listActionItems(db(), prState.id);
    expect(all).toHaveLength(2);

    const pendingOnly = await listActionItems(db(), prState.id, { status: 'pending' });
    expect(pendingOnly.map((item) => item.stableKey)).toEqual(['thread-1']);

    const afterCursor = await listActionItems(db(), prState.id, undefined, all[0]!.id);
    expect(afterCursor.map((item) => item.stableKey)).toEqual(['thread-2']);
  });
});

describe('countActionItemsByStatus', () => {
  it('counts action items grouped by status, defaulting missing statuses to 0', async () => {
    const prState = await createPullRequestState(5);
    await upsertActionItems(db(), prState.id, [
      { stableKey: 'thread-1', subject: 'A', status: 'pending' },
      { stableKey: 'thread-2', subject: 'B', status: 'pending' },
      { stableKey: 'thread-3', subject: 'C', status: 'done' },
    ]);

    const counts = await countActionItemsByStatus(db(), prState.id);

    expect(counts).toEqual({ pending: 2, in_progress: 0, done: 1 });
  });
});

describe('getActionItem', () => {
  it('returns the matching action item by (pullRequestStateId, stableKey)', async () => {
    const prState = await createPullRequestState(6);
    await upsertActionItems(db(), prState.id, [
      { stableKey: 'thread-1', subject: 'A', status: 'pending' },
    ]);

    const found = await getActionItem(db(), prState.id, 'thread-1');
    const notFound = await getActionItem(db(), prState.id, 'thread-missing');

    expect(found?.subject).toBe('A');
    expect(notFound).toBeNull();
  });
});

describe('listActionItemsWithMetadata', () => {
  it('returns an empty array when the PR state has no action items', async () => {
    const prState = await createPullRequestState(7);

    const result = await listActionItemsWithMetadata(db(), prState.id);

    expect(result).toEqual([]);
  });

  it('orders items by status rank (pending, in_progress, done), then createdAt, then stableKey', async () => {
    const prState = await createPullRequestState(8);
    await upsertActionItems(db(), prState.id, [
      { stableKey: 'z-done', subject: 'Done item', status: 'done' },
      { stableKey: 'a-pending', subject: 'Pending item A', status: 'pending' },
      { stableKey: 'b-pending', subject: 'Pending item B', status: 'pending' },
      { stableKey: 'mid', subject: 'In progress item', status: 'in_progress' },
    ]);

    const result = await listActionItemsWithMetadata(db(), prState.id);

    expect(result.map((item) => item.stableKey)).toEqual([
      'a-pending',
      'b-pending',
      'mid',
      'z-done',
    ]);
    expect(result.every((item) => Array.isArray(item.sources))).toBe(true);
  });
});
