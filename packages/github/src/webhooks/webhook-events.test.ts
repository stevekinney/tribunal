import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import { webhookEvent } from '@tribunal/database/schema';
import type { GithubServiceContext } from '../context.js';
import { storeWebhookEvent, type StoreWebhookEventData } from './webhook-events.js';

function createGithubContext(testContext: TestContext): GithubServiceContext {
  return {
    db: testContext.db as unknown as GithubServiceContext['db'],
    cache: {} as GithubServiceContext['cache'],
    getInstallationOctokit: vi.fn(),
  };
}

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

function eventData(overrides: Partial<StoreWebhookEventData> = {}): StoreWebhookEventData {
  return {
    eventType: 'issues',
    action: 'opened',
    deliveryId: 'delivery-1',
    payload: '{"issue":{"number":1}}',
    repositoryId: 7001,
    repositoryOwner: 'lostgradient',
    repositoryName: 'tribunal',
    installationId: null,
    senderId: null,
    senderLogin: null,
    ...overrides,
  };
}

describe('storeWebhookEvent', () => {
  it('inserts a new row and returns its identifying/matching fields', async () => {
    const context = createGithubContext(testContext);

    const row = await storeWebhookEvent(context, eventData());

    expect(row.eventType).toBe('issues');
    expect(row.action).toBe('opened');
    expect(row.repositoryId).toBe(7001);

    const rows = await testContext.db
      .select()
      .from(webhookEvent)
      .where(eq(webhookEvent.deliveryId, 'delivery-1'));
    expect(rows).toHaveLength(1);
  });

  it('is idempotent on deliveryId: a retry after the row already committed returns the existing row instead of throwing', async () => {
    const context = createGithubContext(testContext);

    const first = await storeWebhookEvent(context, eventData());
    // Simulate a retry after a dropped connection: the caller re-invokes
    // storeWebhookEvent with the same deliveryId once the row already
    // exists (mirroring the webhook route's bounded in-process retry).
    const retry = await storeWebhookEvent(context, eventData());

    expect(retry.id).toBe(first.id);

    const rows = await testContext.db
      .select()
      .from(webhookEvent)
      .where(eq(webhookEvent.deliveryId, 'delivery-1'));
    expect(rows).toHaveLength(1);
  });
});
