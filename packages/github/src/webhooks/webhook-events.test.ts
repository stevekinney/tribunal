import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * The two failure branches below (a conflicted insert with no `deliveryId`
 * to re-select by, and a conflicted insert whose re-select finds nothing)
 * are defensive guards against states the real database can never actually
 * produce -- `onConflictDoNothing({ target: webhookEvent.deliveryId })`
 * only ever conflicts on a non-null `deliveryId` (multiple `null`s are
 * distinct under a unique constraint), and a conflict guarantees a row with
 * that exact `deliveryId` exists to re-select. A hand-built fake `db` --
 * scoped to just these two tests via `vi.spyOn`, not a file-wide `vi.mock`,
 * so the real-database tests above are unaffected -- is the only way to
 * exercise them.
 */
describe('storeWebhookEvent (defensive guards unreachable via the real database)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createFakeDbContext(options: {
    insertReturning: unknown[];
    selectReturning?: unknown[];
  }): Promise<GithubServiceContext> {
    const repositoriesService = await import('../repositories/service.js');
    vi.spyOn(repositoriesService, 'getOrCreateRepository').mockResolvedValue(undefined as never);

    const insertReturning = vi.fn().mockResolvedValue(options.insertReturning);
    const onConflictDoNothing = vi.fn(() => ({ returning: insertReturning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));

    const selectLimit = vi.fn().mockResolvedValue(options.selectReturning ?? []);
    const selectWhere = vi.fn(() => ({ limit: selectLimit }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    return {
      db: { insert, select } as unknown as GithubServiceContext['db'],
      cache: {} as GithubServiceContext['cache'],
      getInstallationOctokit: vi.fn(),
    };
  }

  it('throws when the insert conflicts but no deliveryId was supplied to re-select by', async () => {
    const context = await createFakeDbContext({ insertReturning: [] });

    await expect(storeWebhookEvent(context, eventData({ deliveryId: null }))).rejects.toThrow(
      'storeWebhookEvent: insert conflicted without a deliveryId to re-select by',
    );
  });

  it('throws when the insert conflicts and the re-select finds no existing row', async () => {
    const context = await createFakeDbContext({ insertReturning: [], selectReturning: [] });

    await expect(storeWebhookEvent(context, eventData())).rejects.toThrow(
      'storeWebhookEvent: insert conflicted on delivery delivery-1 but no existing row was found',
    );
  });
});
