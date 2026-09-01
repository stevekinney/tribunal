import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { agent, costEvent, repository, user, userReviewSettings } from '@tribunal/database/schema';
import { runWithDatabase } from '$lib/server/database';
import { listCostEvents, summarizeCostEvents } from './cost-event-reader';

describe('cost event reader', () => {
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
      { id: 9003, owner: 'lost-gradient', name: 'agents', defaultBranch: 'main' },
    ]);
    await testDb.db.insert(agent).values({
      id: 'agent-1',
      userId: ownerId,
      slug: 'security',
      description: 'Security specialist',
      body: 'Review for security defects.',
    });
  });

  function withTestDatabase<T>(operation: () => Promise<T>): Promise<T> {
    return runWithDatabase(testDb.db as never, operation);
  }

  async function seedEvent(input: {
    key: string;
    userId: number;
    amountUsd: string;
    repositoryId?: number | null;
    agentId?: string | null;
    source?: string;
    occurredAt?: Date;
  }) {
    await testDb.db.insert(costEvent).values({
      idempotencyKey: input.key,
      userId: input.userId,
      source: input.source ?? 'estimate',
      repositoryId: input.repositoryId === undefined ? 9001 : input.repositoryId,
      agentId: input.agentId === undefined ? 'agent-1' : input.agentId,
      amountUsd: input.amountUsd,
      meta: { cacheReadTokens: 12 },
      occurredAt: input.occurredAt ?? new Date('2026-08-01T00:00:00.000Z'),
    });
  }

  it('projects a ledger row without its metadata payload or idempotency key', async () => {
    expect.assertions(2);
    await seedEvent({ key: 'event-1', userId: ownerId, amountUsd: '2.50' });

    const page = await withTestDatabase(() => listCostEvents(ownerId, { limit: 25, offset: 0 }));

    expect(page.items).toEqual([
      {
        occurredAt: '2026-08-01T00:00:00.000Z',
        amountUsd: 2.5,
        source: 'estimate',
        repositoryId: 9001,
        repositoryOwner: 'lost-gradient',
        repositoryName: 'tribunal',
        agentSlug: 'security',
        reviewRunId: null,
      },
    ]);
    expect(JSON.stringify(page.items)).not.toMatch(/event-1|cacheReadTokens/);
  });

  it("lists only the caller's own ledger, newest first", async () => {
    expect.assertions(1);
    await seedEvent({
      key: 'event-old',
      userId: ownerId,
      amountUsd: '1.00',
      occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    await seedEvent({
      key: 'event-new',
      userId: ownerId,
      amountUsd: '3.00',
      occurredAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await seedEvent({
      key: 'event-theirs',
      userId: otherUserId,
      amountUsd: '9.00',
      agentId: null,
    });

    const page = await withTestDatabase(() => listCostEvents(ownerId, { limit: 25, offset: 0 }));

    expect(page.items.map((event) => event.amountUsd)).toEqual([3, 1]);
  });

  it('restricts the list to one source when asked', async () => {
    expect.assertions(1);
    await seedEvent({ key: 'event-estimate', userId: ownerId, amountUsd: '1.00' });
    await seedEvent({
      key: 'event-reconciled',
      userId: ownerId,
      amountUsd: '2.00',
      source: 'reconciled',
    });

    const page = await withTestDatabase(() =>
      listCostEvents(ownerId, { limit: 25, offset: 0, source: 'reconciled' }),
    );

    expect(page.items.map((event) => event.amountUsd)).toEqual([2]);
  });

  it('reports that a further page exists', async () => {
    expect.assertions(2);
    await seedEvent({
      key: 'event-a',
      userId: ownerId,
      amountUsd: '1.00',
      occurredAt: new Date('2026-08-02T00:00:00.000Z'),
    });
    await seedEvent({
      key: 'event-b',
      userId: ownerId,
      amountUsd: '2.00',
      occurredAt: new Date('2026-08-01T00:00:00.000Z'),
    });

    const page = await withTestDatabase(() => listCostEvents(ownerId, { limit: 1, offset: 0 }));

    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
  });

  it('pages rows sharing one timestamp without repeating or skipping any', async () => {
    expect.assertions(3);
    const tied = new Date('2026-08-01T00:00:00.000Z');
    await seedEvent({ key: 'event-a', userId: ownerId, amountUsd: '1.00', occurredAt: tied });
    await seedEvent({ key: 'event-b', userId: ownerId, amountUsd: '2.00', occurredAt: tied });
    await seedEvent({ key: 'event-c', userId: ownerId, amountUsd: '3.00', occurredAt: tied });

    const firstPage = await withTestDatabase(() =>
      listCostEvents(ownerId, { limit: 2, offset: 0 }),
    );
    const secondPage = await withTestDatabase(() =>
      listCostEvents(ownerId, { limit: 2, offset: 2 }),
    );
    const seen = [...firstPage.items, ...secondPage.items].map((event) => event.amountUsd);

    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.hasMore).toBe(false);
    // Ordering ties on the primary key, so consecutive offsets traverse the
    // ledger exactly once rather than reshuffling between queries.
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('totals a window and rolls it up by repository and agent', async () => {
    expect.assertions(4);
    const now = new Date();
    await seedEvent({ key: 'event-1', userId: ownerId, amountUsd: '1.50', occurredAt: now });
    await seedEvent({
      key: 'event-2',
      userId: ownerId,
      amountUsd: '2.50',
      repositoryId: 9002,
      agentId: null,
      occurredAt: now,
    });
    await seedEvent({
      key: 'event-outside-window',
      userId: ownerId,
      amountUsd: '99.00',
      occurredAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    const summary = await withTestDatabase(() =>
      summarizeCostEvents(ownerId, { source: 'estimate', windowDays: 30 }),
    );

    expect(summary.eventCount).toBe(2);
    expect(summary.totalUsd).toBe(4);
    expect(summary.byRepository).toEqual([
      { label: 'lost-gradient/cinder', amountUsd: 2.5 },
      { label: 'lost-gradient/tribunal', amountUsd: 1.5 },
    ]);
    expect(summary.byAgent).toEqual([
      { label: 'Unassigned', amountUsd: 2.5 },
      { label: 'security', amountUsd: 1.5 },
    ]);
  });

  it('orders equal totals deterministically by label, in both directions', async () => {
    expect.assertions(1);
    // Seeded newest first, so the rollup encounters them as cinder, tribunal,
    // agents — an order the comparator has to both raise and lower entries
    // from, rather than one it could produce by luck.
    const now = Date.now();
    await seedEvent({
      key: 'event-cinder',
      userId: ownerId,
      amountUsd: '1.00',
      repositoryId: 9002,
      occurredAt: new Date(now),
    });
    await seedEvent({
      key: 'event-tribunal',
      userId: ownerId,
      amountUsd: '1.00',
      repositoryId: 9001,
      occurredAt: new Date(now - 60_000),
    });
    await seedEvent({
      key: 'event-agents',
      userId: ownerId,
      amountUsd: '1.00',
      repositoryId: 9003,
      occurredAt: new Date(now - 120_000),
    });

    const summary = await withTestDatabase(() =>
      summarizeCostEvents(ownerId, { source: 'estimate', windowDays: 30 }),
    );

    expect(summary.byRepository).toEqual([
      { label: 'lost-gradient/agents', amountUsd: 1 },
      { label: 'lost-gradient/cinder', amountUsd: 1 },
      { label: 'lost-gradient/tribunal', amountUsd: 1 },
    ]);
  });

  it('labels a ledger row with no repository as unassigned', async () => {
    expect.assertions(1);
    await seedEvent({
      key: 'event-unassigned',
      userId: ownerId,
      amountUsd: '1.00',
      repositoryId: null,
      agentId: null,
      occurredAt: new Date(),
    });

    const summary = await withTestDatabase(() =>
      summarizeCostEvents(ownerId, { source: 'estimate', windowDays: 1 }),
    );

    expect(summary.byRepository).toEqual([{ label: 'Unassigned', amountUsd: 1 }]);
  });

  it('never creates a settings row while reading', async () => {
    expect.assertions(1);
    await seedEvent({ key: 'event-1', userId: ownerId, amountUsd: '1.00', occurredAt: new Date() });

    await withTestDatabase(() =>
      summarizeCostEvents(ownerId, { source: 'estimate', windowDays: 7 }),
    );
    const settings = await testDb.db.select().from(userReviewSettings);

    expect(settings).toEqual([]);
  });
});
