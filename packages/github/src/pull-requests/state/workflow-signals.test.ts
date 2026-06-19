import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  githubInstallationRepository,
  repositoryReviewSettings,
  reviewIntent,
  userReviewSettings,
} from '@tribunal/database/schema';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import type { GithubServiceContext } from '../../context.js';
import {
  buildPullRequestOrchestratorWorkflowId,
  mapPullRequestEventToReviewIntentKind,
  signalPullRequestClosed,
  signalPullRequestEvent,
  type PullRequestEventType,
} from './workflow-signals.js';

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
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
  };
}

describe('mapPullRequestEventToReviewIntentKind', () => {
  it.each([
    ['pr_opened', 'start'],
    ['pr_reopened', 'start'],
    ['pr_ready_for_review', 'start'],
    ['pr_synchronized', 'commit_pushed'],
    ['check_completed', 'commit_pushed'],
    ['pr_closed', 'pr_closed'],
  ] satisfies Array<[PullRequestEventType, string]>)('%s maps to %s', (eventType, kind) => {
    expect(mapPullRequestEventToReviewIntentKind(eventType)).toBe(kind);
  });

  it('ignores pull request activity that does not start review-engine work', () => {
    const ignoredEventTypes = [
      'review_submitted',
      'review_dismissed',
      'review_comment_created',
      'review_comment_edited',
      'review_comment_deleted',
      'review_thread_resolved',
      'review_thread_unresolved',
      'issue_comment_created',
      'issue_comment_edited',
      'issue_comment_deleted',
      'base_branch_updated',
      'manual',
    ] satisfies PullRequestEventType[];

    for (const eventType of ignoredEventTypes) {
      expect(mapPullRequestEventToReviewIntentKind(eventType)).toBeNull();
    }
  });
});

describe('buildPullRequestOrchestratorWorkflowId', () => {
  it('builds a deterministic workflow id from repository and pull request numbers', () => {
    expect(buildPullRequestOrchestratorWorkflowId(42, 7)).toBe('review:pr:42:7');
  });
});

describe('signalPullRequestEvent', () => {
  it('inserts one idempotent start intent for a redelivered opened event', async () => {
    const repository = await testContext.factories.repository.create({ id: 42 });
    const { user } = await createWatchedRepository(repository.id, 100);
    const context = createGithubContext();
    const input = {
      repositoryId: repository.id,
      prNumber: 7,
      installationId: 100,
      owner: repository.owner,
      repo: repository.name,
      eventType: 'pr_opened' as const,
      eventId: 'delivery-1',
      headSha: 'abc123',
    };

    const first = await signalPullRequestEvent(context, input);
    const second = await signalPullRequestEvent(context, input);

    expect(first).toMatchObject({
      ok: true,
      intentKind: 'start',
      enqueued: true,
      enqueueStatus: 'enqueued',
    });
    expect(second).toMatchObject({
      ok: true,
      intentKind: 'start',
      enqueued: false,
      enqueueStatus: 'duplicate',
    });

    const rows = await testContext.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.deliveryId, 'delivery-1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'start',
      repositoryId: repository.id,
      userId: user.id,
      prNumber: 7,
      headSha: 'abc123',
      prState: null,
    });
  });

  it('inserts a commit_pushed intent for synchronize events', async () => {
    const repository = await testContext.factories.repository.create({ id: 43 });
    await createWatchedRepository(repository.id, 100);
    const context = createGithubContext();

    const result = await signalPullRequestEvent(context, {
      repositoryId: repository.id,
      prNumber: 8,
      installationId: 100,
      owner: repository.owner,
      repo: repository.name,
      eventType: 'pr_synchronized',
      eventId: 'delivery-2',
      headSha: 'def456',
    });

    expect(result).toMatchObject({
      ok: true,
      intentKind: 'commit_pushed',
      enqueued: true,
      enqueueStatus: 'enqueued',
    });
    const rows = await testContext.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.deliveryId, 'delivery-2'));
    expect(rows[0]).toMatchObject({ kind: 'commit_pushed', headSha: 'def456' });
  });

  it('inserts a commit_pushed intent for check-completed events', async () => {
    const repository = await testContext.factories.repository.create({ id: 50 });
    await createWatchedRepository(repository.id, 100);
    const context = createGithubContext();

    const result = await signalPullRequestEvent(context, {
      repositoryId: repository.id,
      prNumber: 16,
      installationId: 100,
      owner: repository.owner,
      repo: repository.name,
      eventType: 'check_completed',
      eventId: 'delivery-check-completed',
      headSha: 'checkhead',
    });

    expect(result).toMatchObject({
      ok: true,
      intentKind: 'commit_pushed',
      enqueued: true,
      enqueueStatus: 'enqueued',
    });
    const rows = await testContext.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.deliveryId, 'delivery-check-completed'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'commit_pushed',
      repositoryId: repository.id,
      prNumber: 16,
      headSha: 'checkhead',
    });
  });

  it('deduplicates same-delivery intents by event kind, repository, and pull request', async () => {
    const repository = await testContext.factories.repository.create({ id: 49 });
    await createWatchedRepository(repository.id, 100);
    const context = createGithubContext();

    const first = await signalPullRequestEvent(context, {
      repositoryId: repository.id,
      prNumber: 14,
      installationId: 100,
      owner: repository.owner,
      repo: repository.name,
      eventType: 'pr_synchronized',
      eventId: 'delivery-multiple-pull-requests',
      headSha: 'first',
    });
    const second = await signalPullRequestEvent(context, {
      repositoryId: repository.id,
      prNumber: 15,
      installationId: 100,
      owner: repository.owner,
      repo: repository.name,
      eventType: 'pr_synchronized',
      eventId: 'delivery-multiple-pull-requests',
      headSha: 'second',
    });

    expect(first).toMatchObject({
      ok: true,
      intentKind: 'commit_pushed',
      enqueued: true,
      enqueueStatus: 'enqueued',
    });
    expect(second).toMatchObject({
      ok: true,
      intentKind: 'commit_pushed',
      enqueued: true,
      enqueueStatus: 'enqueued',
    });

    const rows = await testContext.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.deliveryId, 'delivery-multiple-pull-requests'))
      .orderBy(reviewIntent.prNumber);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ prNumber: 14, headSha: 'first' });
    expect(rows[1]).toMatchObject({ prNumber: 15, headSha: 'second' });
  });

  it('enqueues one intent per watched user on a shared repository', async () => {
    const repository = await testContext.factories.repository.create({ id: 51 });
    const firstWatcher = await createWatchedRepository(repository.id, 100);
    const secondWatcher = await createWatchedRepository(repository.id, 101);
    const context = createGithubContext();

    const result = await signalPullRequestEvent(context, {
      repositoryId: repository.id,
      prNumber: 17,
      installationId: 100,
      owner: repository.owner,
      repo: repository.name,
      eventType: 'pr_opened',
      eventId: 'delivery-shared-repository',
      headSha: 'shared-head',
    });

    expect(result).toMatchObject({
      ok: true,
      intentKind: 'start',
      enqueued: true,
      enqueueStatus: 'enqueued',
    });
    const rows = await testContext.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.deliveryId, 'delivery-shared-repository'))
      .orderBy(reviewIntent.userId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.userId)).toEqual([firstWatcher.user.id, secondWatcher.user.id]);
  });

  it('does not enqueue an intent when no active user watches the repository', async () => {
    const repository = await testContext.factories.repository.create({ id: 52 });
    const context = createGithubContext();

    const result = await signalPullRequestEvent(context, {
      repositoryId: repository.id,
      prNumber: 18,
      installationId: 100,
      owner: repository.owner,
      repo: repository.name,
      eventType: 'pr_opened',
      eventId: 'delivery-unwatched-repository',
      headSha: 'unwatched-head',
    });

    expect(result).toMatchObject({
      ok: true,
      intentKind: 'start',
      enqueued: false,
      enqueueStatus: 'no_watchers',
    });
    const rows = await testContext.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.deliveryId, 'delivery-unwatched-repository'));
    expect(rows).toHaveLength(0);
  });

  it('returns not enqueued for ignored event types', async () => {
    const repository = await testContext.factories.repository.create({ id: 45 });
    const context = createGithubContext();

    const result = await signalPullRequestEvent(context, {
      repositoryId: repository.id,
      prNumber: 10,
      installationId: 100,
      owner: repository.owner,
      repo: repository.name,
      eventType: 'review_submitted',
      eventId: 'delivery-ignored',
      headSha: 'abc123',
    });

    expect(result).toEqual({
      ok: true,
      workflowId: `review:pr:${repository.id}:10`,
      enqueued: false,
    });
  });

  it('returns a classified failure when an intent event has no delivery id', async () => {
    const repository = await testContext.factories.repository.create({ id: 46 });
    const context = createGithubContext();

    const result = await signalPullRequestEvent(context, {
      repositoryId: repository.id,
      prNumber: 11,
      installationId: 100,
      owner: repository.owner,
      repo: repository.name,
      eventType: 'pr_opened',
      headSha: 'abc123',
    });

    expect(result).toEqual({
      ok: false,
      workflowId: `review:pr:${repository.id}:11`,
      intentKind: 'start',
      enqueued: false,
      error: 'Cannot enqueue review intent without a GitHub delivery id.',
    });
  });
});

describe('signalPullRequestClosed', () => {
  it('inserts an idempotent pr_closed intent with final pull request state', async () => {
    const repository = await testContext.factories.repository.create({ id: 44 });
    await createWatchedRepository(repository.id, 100);
    const context = createGithubContext();
    const input = {
      repositoryId: repository.id,
      prNumber: 9,
      merged: true,
      eventId: 'delivery-3',
      headSha: 'fed789',
    };

    const first = await signalPullRequestClosed(context, input);
    const second = await signalPullRequestClosed(context, input);

    expect(first).toMatchObject({
      ok: true,
      intentKind: 'pr_closed',
      enqueued: true,
      enqueueStatus: 'enqueued',
    });
    expect(second).toMatchObject({
      ok: true,
      intentKind: 'pr_closed',
      enqueued: false,
      enqueueStatus: 'duplicate',
    });

    const rows = await testContext.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.deliveryId, 'delivery-3'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'pr_closed',
      headSha: 'fed789',
      prState: 'merged',
    });
  });

  it('records closed state for unmerged pull requests', async () => {
    const repository = await testContext.factories.repository.create({ id: 47 });
    await createWatchedRepository(repository.id, 100);
    const context = createGithubContext();

    const result = await signalPullRequestClosed(context, {
      repositoryId: repository.id,
      prNumber: 12,
      merged: false,
      eventId: 'delivery-4',
      headSha: null,
    });

    expect(result).toMatchObject({
      ok: true,
      intentKind: 'pr_closed',
      enqueued: true,
      enqueueStatus: 'enqueued',
    });

    const rows = await testContext.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.deliveryId, 'delivery-4'));
    expect(rows[0]).toMatchObject({
      kind: 'pr_closed',
      headSha: null,
      prState: 'closed',
    });
  });

  it('returns a classified failure when a closed event has no delivery id', async () => {
    const repository = await testContext.factories.repository.create({ id: 48 });
    const context = createGithubContext();

    const result = await signalPullRequestClosed(context, {
      repositoryId: repository.id,
      prNumber: 13,
      merged: false,
      headSha: null,
    });

    expect(result).toEqual({
      ok: false,
      workflowId: `review:pr:${repository.id}:13`,
      intentKind: 'pr_closed',
      enqueued: false,
      error: 'Cannot enqueue review intent without a GitHub delivery id.',
    });
  });
});

async function createWatchedRepository(repositoryId: number, installationId: number) {
  const user = await testContext.factories.user.create();
  const installation = await testContext.factories.githubInstallation.createForUser(user.id, {
    installationId,
    status: 'active',
  });
  await testContext.db.insert(githubInstallationRepository).values({
    installationId: installation.installationId,
    repositoryId,
    isActive: true,
  });
  await testContext.db.insert(userReviewSettings).values({
    userId: user.id,
    reviewsEnabled: true,
  });
  await testContext.db.insert(repositoryReviewSettings).values({
    userId: user.id,
    repositoryId,
    watched: true,
  });

  return { user, installation };
}
