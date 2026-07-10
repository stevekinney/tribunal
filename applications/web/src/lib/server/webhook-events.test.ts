import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { runWithDatabase } from '$lib/server/database';
import { repository, webhookEvent } from '@tribunal/database/schema';
import {
  getWebhookEventFilterOptions,
  listWebhookEvents,
  parseWebhookEventFilters,
} from './webhook-events';

describe('webhook-events server helper', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  function withTestDatabase<T>(operation: () => Promise<T>): Promise<T> {
    return runWithDatabase(testDb.db as never, operation);
  }

  async function createRepository(overrides: { id: number; owner: string; name: string }) {
    const [repo] = await testDb.db
      .insert(repository)
      .values({
        id: overrides.id,
        owner: overrides.owner,
        name: overrides.name,
        uri: `https://github.com/${overrides.owner}/${overrides.name}.git`,
      })
      .returning();
    return repo;
  }

  async function createWebhookEvent(overrides: {
    repositoryId: number;
    eventType: string;
    action?: string | null;
    deliveryId?: string | null;
    payload?: string;
    prNumber?: number;
    issueNumber?: number;
    senderLogin?: string;
    ref?: string;
    commitSha?: string;
    receivedAt?: Date;
  }) {
    const [row] = await testDb.db
      .insert(webhookEvent)
      .values({
        eventType: overrides.eventType,
        action: overrides.action ?? null,
        deliveryId: overrides.deliveryId ?? null,
        payload: overrides.payload ?? JSON.stringify({ ok: true }),
        repositoryId: overrides.repositoryId,
        installationId: null,
        senderId: null,
        senderLogin: overrides.senderLogin ?? null,
        prNumber: overrides.prNumber,
        issueNumber: overrides.issueNumber,
        ref: overrides.ref,
        commitSha: overrides.commitSha,
        receivedAt: overrides.receivedAt ?? new Date(),
      })
      .returning();
    return row;
  }

  describe('listWebhookEvents', () => {
    it('never returns events outside the authorized repository set', async () => {
      const allowed = await createRepository({ id: 1, owner: 'acme', name: 'allowed' });
      const forbidden = await createRepository({ id: 2, owner: 'acme', name: 'forbidden' });

      await withTestDatabase(async () => {
        await createWebhookEvent({ repositoryId: allowed.id, eventType: 'push' });
        await createWebhookEvent({ repositoryId: forbidden.id, eventType: 'push' });

        const result = await listWebhookEvents([allowed.id]);

        expect(result.totalCount).toBe(1);
        expect(result.events).toHaveLength(1);
        expect(result.events[0]?.repositoryId).toBe(allowed.id);
      });
    });

    it('returns an empty result when the authorized repository set is empty', async () => {
      const repo = await createRepository({ id: 1, owner: 'acme', name: 'repo' });

      await withTestDatabase(async () => {
        await createWebhookEvent({ repositoryId: repo.id, eventType: 'push' });

        const result = await listWebhookEvents([]);

        expect(result).toEqual({ events: [], page: 1, perPage: 50, totalCount: 0 });
      });
    });

    it('supports a fixed repositoryId for repository-scoped pages, still bounded by the authorized set', async () => {
      const repoA = await createRepository({ id: 1, owner: 'acme', name: 'a' });
      const repoB = await createRepository({ id: 2, owner: 'acme', name: 'b' });

      await withTestDatabase(async () => {
        await createWebhookEvent({ repositoryId: repoA.id, eventType: 'push' });
        await createWebhookEvent({ repositoryId: repoB.id, eventType: 'push' });

        // Authorized for both, but the route fixes the query to repo A.
        const result = await listWebhookEvents([repoA.id, repoB.id], {}, repoA.id);

        expect(result.totalCount).toBe(1);
        expect(result.events[0]?.repositoryId).toBe(repoA.id);
      });
    });

    it('never leaks a fixed repositoryId outside the authorized set', async () => {
      const repoA = await createRepository({ id: 1, owner: 'acme', name: 'a' });
      const repoB = await createRepository({ id: 2, owner: 'acme', name: 'b' });

      await withTestDatabase(async () => {
        await createWebhookEvent({ repositoryId: repoB.id, eventType: 'push' });

        // Caller is only authorized for repo A, but a fixed repositoryId of B is
        // requested (should never happen if the route checks access first, but
        // the helper must not trust it either).
        const result = await listWebhookEvents([repoA.id], {}, repoB.id);

        expect(result.totalCount).toBe(0);
        expect(result.events).toHaveLength(0);
      });
    });

    it('defaults to receivedAt descending order', async () => {
      const repo = await createRepository({ id: 1, owner: 'acme', name: 'repo' });

      await withTestDatabase(async () => {
        await createWebhookEvent({
          repositoryId: repo.id,
          eventType: 'push',
          deliveryId: 'older',
          receivedAt: new Date('2026-01-01T00:00:00Z'),
        });
        await createWebhookEvent({
          repositoryId: repo.id,
          eventType: 'push',
          deliveryId: 'newer',
          receivedAt: new Date('2026-01-02T00:00:00Z'),
        });

        const result = await listWebhookEvents([repo.id]);

        expect(result.events.map((e) => e.deliveryId)).toEqual(['newer', 'older']);
      });
    });

    it('filters by event type, action, pull request number, issue number, sender, ref, and delivery ID', async () => {
      const repo = await createRepository({ id: 1, owner: 'acme', name: 'repo' });

      await withTestDatabase(async () => {
        await createWebhookEvent({
          repositoryId: repo.id,
          eventType: 'pull_request',
          action: 'opened',
          deliveryId: 'match',
          prNumber: 42,
          senderLogin: 'octocat',
          ref: 'refs/heads/feature',
        });
        await createWebhookEvent({
          repositoryId: repo.id,
          eventType: 'issues',
          action: 'closed',
          deliveryId: 'no-match',
          issueNumber: 7,
          senderLogin: 'other-user',
        });

        const byEventType = await listWebhookEvents([repo.id], { eventType: 'pull_request' });
        expect(byEventType.totalCount).toBe(1);

        const byAction = await listWebhookEvents([repo.id], { action: 'closed' });
        expect(byAction.totalCount).toBe(1);
        expect(byAction.events[0]?.deliveryId).toBe('no-match');

        const byPrNumber = await listWebhookEvents([repo.id], { prNumber: 42 });
        expect(byPrNumber.totalCount).toBe(1);
        expect(byPrNumber.events[0]?.deliveryId).toBe('match');

        const byIssueNumber = await listWebhookEvents([repo.id], { issueNumber: 7 });
        expect(byIssueNumber.totalCount).toBe(1);
        expect(byIssueNumber.events[0]?.deliveryId).toBe('no-match');

        const bySender = await listWebhookEvents([repo.id], { senderLogin: 'octocat' });
        expect(bySender.totalCount).toBe(1);

        const byRef = await listWebhookEvents([repo.id], { ref: 'refs/heads/feature' });
        expect(byRef.totalCount).toBe(1);

        const byDeliveryId = await listWebhookEvents([repo.id], { deliveryId: 'match' });
        expect(byDeliveryId.totalCount).toBe(1);
        expect(byDeliveryId.events[0]?.deliveryId).toBe('match');
      });
    });

    it('supports pagination', async () => {
      const repo = await createRepository({ id: 1, owner: 'acme', name: 'repo' });

      await withTestDatabase(async () => {
        for (let i = 0; i < 5; i++) {
          await createWebhookEvent({
            repositoryId: repo.id,
            eventType: 'push',
            deliveryId: `delivery-${i}`,
            receivedAt: new Date(2026, 0, i + 1),
          });
        }

        const firstPage = await listWebhookEvents([repo.id], { page: 1, perPage: 2 });
        expect(firstPage.totalCount).toBe(5);
        expect(firstPage.events).toHaveLength(2);

        const secondPage = await listWebhookEvents([repo.id], { page: 2, perPage: 2 });
        expect(secondPage.events).toHaveLength(2);
        expect(secondPage.events[0]?.deliveryId).not.toBe(firstPage.events[0]?.deliveryId);
      });
    });

    it('clamps a page number beyond the last valid page instead of returning an empty page', async () => {
      const repo = await createRepository({ id: 1, owner: 'acme', name: 'repo' });

      await withTestDatabase(async () => {
        await createWebhookEvent({ repositoryId: repo.id, eventType: 'push' });

        const result = await listWebhookEvents([repo.id], { page: 5, perPage: 50 });

        expect(result.totalCount).toBe(1);
        expect(result.page).toBe(1);
        expect(result.events).toHaveLength(1);
      });
    });

    it('parses valid JSON payloads without throwing', async () => {
      const repo = await createRepository({ id: 1, owner: 'acme', name: 'repo' });

      await withTestDatabase(async () => {
        await createWebhookEvent({
          repositoryId: repo.id,
          eventType: 'push',
          payload: JSON.stringify({ ref: 'refs/heads/main' }),
        });

        const result = await listWebhookEvents([repo.id]);

        expect(result.events[0]?.payload).toEqual({ ref: 'refs/heads/main' });
        expect(result.events[0]?.payloadParseError).toBe(false);
      });
    });

    it('handles invalid JSON payloads without throwing the page load', async () => {
      const repo = await createRepository({ id: 1, owner: 'acme', name: 'repo' });

      await withTestDatabase(async () => {
        await createWebhookEvent({
          repositoryId: repo.id,
          eventType: 'push',
          payload: 'not valid json {{{',
        });

        const result = await listWebhookEvents([repo.id]);

        expect(result.events[0]?.payload).toBeNull();
        expect(result.events[0]?.payloadParseError).toBe(true);
        expect(result.events[0]?.rawPayload).toBe('not valid json {{{');
      });
    });

    it('includes repository identity via the join', async () => {
      const repo = await createRepository({ id: 1, owner: 'acme', name: 'repo' });

      await withTestDatabase(async () => {
        await createWebhookEvent({ repositoryId: repo.id, eventType: 'push' });

        const result = await listWebhookEvents([repo.id]);

        expect(result.events[0]).toMatchObject({
          repositoryOwner: 'acme',
          repositoryName: 'repo',
        });
      });
    });
  });

  describe('getWebhookEventFilterOptions', () => {
    it('derives options from stored events, scoped to the authorized set', async () => {
      const allowed = await createRepository({ id: 1, owner: 'acme', name: 'allowed' });
      const forbidden = await createRepository({ id: 2, owner: 'acme', name: 'forbidden' });

      await withTestDatabase(async () => {
        await createWebhookEvent({
          repositoryId: allowed.id,
          eventType: 'pull_request',
          action: 'opened',
        });
        await createWebhookEvent({
          repositoryId: forbidden.id,
          eventType: 'issues',
          action: 'closed',
        });

        const options = await getWebhookEventFilterOptions([allowed.id]);

        expect(options.eventTypes).toEqual(['pull_request']);
        expect(options.actions).toEqual(['opened']);
      });
    });

    it('merges in subscribed App events even when nothing has been received yet', async () => {
      const repo = await createRepository({ id: 1, owner: 'acme', name: 'repo' });

      await withTestDatabase(async () => {
        const options = await getWebhookEventFilterOptions([repo.id], undefined, [
          'check_suite',
          'pull_request',
        ]);

        expect(options.eventTypes).toEqual(['check_suite', 'pull_request']);
      });
    });

    it('returns only subscribed events when the authorized set is empty', async () => {
      await withTestDatabase(async () => {
        const options = await getWebhookEventFilterOptions([], undefined, ['push']);
        expect(options).toEqual({ eventTypes: ['push'], actions: [] });
      });
    });

    it('does not depend on any hand-maintained complete webhook catalog', async () => {
      const repo = await createRepository({ id: 1, owner: 'acme', name: 'repo' });

      await withTestDatabase(async () => {
        await createWebhookEvent({ repositoryId: repo.id, eventType: 'a_totally_novel_event' });

        const options = await getWebhookEventFilterOptions([repo.id]);

        // An event type not present in any known catalog still surfaces, because
        // options are derived from stored rows, not filtered against a catalog.
        expect(options.eventTypes).toEqual(['a_totally_novel_event']);
      });
    });
  });

  describe('parseWebhookEventFilters', () => {
    it('parses all supported query parameters', () => {
      const url = new URL(
        'https://tribunal.test/webhooks?webhook_event_type=pull_request&webhook_action=opened&webhook_repository_id=42&webhook_sender=octocat&webhook_ref=refs%2Fheads%2Fmain&webhook_delivery_id=abc-123&webhook_pr_number=7&webhook_issue_number=9&webhook_page=2&webhook_per_page=10',
      );

      expect(parseWebhookEventFilters(url)).toEqual({
        eventType: 'pull_request',
        action: 'opened',
        repositoryId: 42,
        prNumber: 7,
        issueNumber: 9,
        senderLogin: 'octocat',
        ref: 'refs/heads/main',
        deliveryId: 'abc-123',
        page: 2,
        perPage: 10,
      });
    });

    it('defaults to page 1 and the default page size', () => {
      const url = new URL('https://tribunal.test/webhooks');
      const filters = parseWebhookEventFilters(url);

      expect(filters.page).toBe(1);
      expect(filters.perPage).toBe(50);
      expect(filters.eventType).toBeUndefined();
    });

    it('caps page size at 100', () => {
      const url = new URL('https://tribunal.test/webhooks?webhook_per_page=500');
      expect(parseWebhookEventFilters(url).perPage).toBe(100);
    });
  });
});
