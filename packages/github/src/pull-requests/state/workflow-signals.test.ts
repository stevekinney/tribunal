import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { reviewIntent } from '@tribunal/database/schema';
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
      'check_completed',
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
    const context = createGithubContext();
    const input = {
      workspaceId: 0,
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

    expect(first).toMatchObject({ ok: true, intentKind: 'start', enqueued: true });
    expect(second).toMatchObject({ ok: true, intentKind: 'start', enqueued: false });

    const rows = await testContext.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.deliveryId, 'delivery-1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'start',
      repositoryId: repository.id,
      prNumber: 7,
      headSha: 'abc123',
      prState: null,
    });
  });

  it('inserts a commit_pushed intent for synchronize events', async () => {
    const repository = await testContext.factories.repository.create({ id: 43 });
    const context = createGithubContext();

    const result = await signalPullRequestEvent(context, {
      workspaceId: 0,
      repositoryId: repository.id,
      prNumber: 8,
      installationId: 100,
      owner: repository.owner,
      repo: repository.name,
      eventType: 'pr_synchronized',
      eventId: 'delivery-2',
      headSha: 'def456',
    });

    expect(result).toMatchObject({ ok: true, intentKind: 'commit_pushed', enqueued: true });
    const rows = await testContext.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.deliveryId, 'delivery-2'));
    expect(rows[0]).toMatchObject({ kind: 'commit_pushed', headSha: 'def456' });
  });

  it('keeps same-delivery intents distinct for different pull requests', async () => {
    const repository = await testContext.factories.repository.create({ id: 49 });
    const context = createGithubContext();

    const first = await signalPullRequestEvent(context, {
      workspaceId: 0,
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
      workspaceId: 0,
      repositoryId: repository.id,
      prNumber: 15,
      installationId: 100,
      owner: repository.owner,
      repo: repository.name,
      eventType: 'pr_synchronized',
      eventId: 'delivery-multiple-pull-requests',
      headSha: 'second',
    });

    expect(first).toMatchObject({ ok: true, intentKind: 'commit_pushed', enqueued: true });
    expect(second).toMatchObject({ ok: true, intentKind: 'commit_pushed', enqueued: true });

    const rows = await testContext.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.deliveryId, 'delivery-multiple-pull-requests'))
      .orderBy(reviewIntent.prNumber);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.prNumber)).toEqual([14, 15]);
    expect(rows.map((row) => row.headSha)).toEqual(['first', 'second']);
  });

  it('returns not enqueued for ignored event types', async () => {
    const repository = await testContext.factories.repository.create({ id: 45 });
    const context = createGithubContext();

    const result = await signalPullRequestEvent(context, {
      workspaceId: 0,
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
      workspaceId: 0,
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

    expect(first).toMatchObject({ ok: true, intentKind: 'pr_closed', enqueued: true });
    expect(second).toMatchObject({ ok: true, intentKind: 'pr_closed', enqueued: false });

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
    const context = createGithubContext();

    const result = await signalPullRequestClosed(context, {
      repositoryId: repository.id,
      prNumber: 12,
      merged: false,
      eventId: 'delivery-4',
      headSha: null,
    });

    expect(result).toMatchObject({ ok: true, intentKind: 'pr_closed', enqueued: true });

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
