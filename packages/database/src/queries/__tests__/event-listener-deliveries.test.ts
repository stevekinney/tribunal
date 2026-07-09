import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, resetIdCounter } from '@tribunal/test/factories';
import { eq } from '../../operators';
import { agent, eventListenerDelivery, tribunalRun, webhookEvent } from '../../schema';
import { createEventListener } from '../event-listeners';
import {
  MAX_EVENT_LISTENER_DELIVERY_ATTEMPTS,
  claimEventListenerDelivery,
  deriveEventListenerDisplayStatus,
  insertPendingEventListenerDeliveries,
  listClaimableEventListenerDeliveries,
  markEventListenerDeliveryFailed,
  markEventListenerDeliverySucceeded,
} from '../event-listener-deliveries';

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
});

afterAll(async () => {
  await testDatabase.close();
});

beforeEach(async () => {
  await testDatabase.reset();
  resetIdCounter();
});

async function insertWebhookEvent(input: { repositoryId: number; eventType?: string }) {
  const [row] = await testDatabase.db
    .insert(webhookEvent)
    .values({
      eventType: input.eventType ?? 'issues',
      action: 'opened',
      deliveryId: `delivery-${Math.random()}`,
      payload: '{}',
      repositoryId: input.repositoryId,
    })
    .returning();
  return row;
}

async function insertTribunalRun(input: { id: string; userId: number; repositoryId: number }) {
  const [row] = await testDatabase.db
    .insert(tribunalRun)
    .values({
      id: input.id,
      userId: input.userId,
      repositoryId: input.repositoryId,
      runKind: 'webhook_event_handler',
    })
    .returning();
  return row;
}

async function createFixture() {
  const factories = createFactories(testDatabase.db);
  const user = await factories.user.create();
  const repository = await factories.repository.create({ id: 6001 });
  const [testAgent] = await testDatabase.db
    .insert(agent)
    .values({
      id: 'agent_1',
      userId: user.id,
      slug: 'agent-1',
      description: 'Test agent',
      body: 'Do the thing.',
    })
    .returning();
  const listener = await createEventListener(testDatabase.db, {
    userId: user.id,
    repositoryId: repository.id,
    name: 'Listener',
    eventType: 'issues',
    agentId: testAgent.id,
  });
  const event = await insertWebhookEvent({ repositoryId: repository.id });
  return { user, repository, testAgent, listener, event };
}

describe('insertPendingEventListenerDeliveries', () => {
  it('inserts a pending row per matched listener', async () => {
    const { listener, event } = await createFixture();

    const inserted = await insertPendingEventListenerDeliveries(
      testDatabase.db,
      [listener.id],
      event.id,
    );

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.status).toBe('pending');
    expect(inserted[0]?.listenerId).toBe(listener.id);
    expect(inserted[0]?.webhookEventId).toBe(event.id);
    expect(inserted[0]?.attemptCount).toBe(0);
  });

  it('redelivery of the same webhook event does not create a duplicate pending row', async () => {
    const { listener, event } = await createFixture();

    const first = await insertPendingEventListenerDeliveries(
      testDatabase.db,
      [listener.id],
      event.id,
    );
    expect(first).toHaveLength(1);

    // Simulate a GitHub redelivery re-matching the same listener against the
    // same already-persisted webhook_event row.
    const second = await insertPendingEventListenerDeliveries(
      testDatabase.db,
      [listener.id],
      event.id,
    );
    expect(second).toHaveLength(0);

    const all = await testDatabase.db
      .select()
      .from(eventListenerDelivery)
      .where(eq(eventListenerDelivery.webhookEventId, event.id));
    expect(all).toHaveLength(1);
  });
});

describe('claimEventListenerDelivery', () => {
  it('claims a pending row, moving it to running and incrementing attempt_count', async () => {
    const { listener, event } = await createFixture();
    const [pending] = await insertPendingEventListenerDeliveries(
      testDatabase.db,
      [listener.id],
      event.id,
    );

    const claimed = await claimEventListenerDelivery(testDatabase.db, pending.id);

    expect(claimed?.status).toBe('running');
    expect(claimed?.attemptCount).toBe(1);
    expect(claimed?.claimedAt).not.toBeNull();
  });

  it('a second concurrent claim attempt on the same row fails', async () => {
    const { listener, event } = await createFixture();
    const [pending] = await insertPendingEventListenerDeliveries(
      testDatabase.db,
      [listener.id],
      event.id,
    );

    const [first, second] = await Promise.all([
      claimEventListenerDelivery(testDatabase.db, pending.id),
      claimEventListenerDelivery(testDatabase.db, pending.id),
    ]);

    const claimedResults = [first, second].filter((result) => result !== null);
    expect(claimedResults).toHaveLength(1);
    expect(claimedResults[0]?.attemptCount).toBe(1);
  });

  it('returns null for a row that is already running, succeeded, failed, or abandoned', async () => {
    const { listener, event } = await createFixture();
    const [pending] = await insertPendingEventListenerDeliveries(
      testDatabase.db,
      [listener.id],
      event.id,
    );
    await claimEventListenerDelivery(testDatabase.db, pending.id);

    const secondAttempt = await claimEventListenerDelivery(testDatabase.db, pending.id);
    expect(secondAttempt).toBeNull();
  });

  it('re-claims a retryable row', async () => {
    const { listener, event } = await createFixture();
    const [pending] = await insertPendingEventListenerDeliveries(
      testDatabase.db,
      [listener.id],
      event.id,
    );
    await claimEventListenerDelivery(testDatabase.db, pending.id);
    await markEventListenerDeliveryFailed(testDatabase.db, pending.id, 'transient error');

    const reclaimed = await claimEventListenerDelivery(testDatabase.db, pending.id);
    expect(reclaimed?.status).toBe('running');
    expect(reclaimed?.attemptCount).toBe(2);
  });
});

describe('markEventListenerDeliverySucceeded / markEventListenerDeliveryFailed', () => {
  it('marks a claimed delivery succeeded with the run id attached', async () => {
    const { user, repository, listener, event } = await createFixture();
    const [pending] = await insertPendingEventListenerDeliveries(
      testDatabase.db,
      [listener.id],
      event.id,
    );
    await claimEventListenerDelivery(testDatabase.db, pending.id);
    await insertTribunalRun({ id: 'run_123', userId: user.id, repositoryId: repository.id });

    await markEventListenerDeliverySucceeded(testDatabase.db, pending.id, 'run_123');

    const [row] = await testDatabase.db
      .select()
      .from(eventListenerDelivery)
      .where(eq(eventListenerDelivery.id, pending.id));
    expect(row?.status).toBe('succeeded');
    expect(row?.runId).toBe('run_123');
  });

  it('moves a failed delivery to retryable while under the attempt cap', async () => {
    const { listener, event } = await createFixture();
    const [pending] = await insertPendingEventListenerDeliveries(
      testDatabase.db,
      [listener.id],
      event.id,
    );
    await claimEventListenerDelivery(testDatabase.db, pending.id);

    const result = await markEventListenerDeliveryFailed(testDatabase.db, pending.id, 'boom');

    expect(result?.status).toBe('retryable');
    expect(result?.lastError).toBe('boom');
  });

  it('abandons a delivery once attempt_count reaches the cap', async () => {
    const { listener, event } = await createFixture();
    const [pending] = await insertPendingEventListenerDeliveries(
      testDatabase.db,
      [listener.id],
      event.id,
    );

    const deliveryId = pending.id;
    for (let attempt = 1; attempt <= MAX_EVENT_LISTENER_DELIVERY_ATTEMPTS; attempt += 1) {
      const claimed = await claimEventListenerDelivery(testDatabase.db, deliveryId);
      expect(claimed?.attemptCount).toBe(attempt);
      const result = await markEventListenerDeliveryFailed(
        testDatabase.db,
        deliveryId,
        `fail ${attempt}`,
      );
      if (attempt < MAX_EVENT_LISTENER_DELIVERY_ATTEMPTS) {
        expect(result?.status).toBe('retryable');
      } else {
        expect(result?.status).toBe('abandoned');
      }
    }

    const abandonedAttempt = await claimEventListenerDelivery(testDatabase.db, deliveryId);
    expect(abandonedAttempt).toBeNull();
  });
});

describe('listClaimableEventListenerDeliveries', () => {
  it('returns pending and retryable rows for the repository, including listener/agent enabled state', async () => {
    const { repository, listener, event, testAgent } = await createFixture();
    const [pending] = await insertPendingEventListenerDeliveries(
      testDatabase.db,
      [listener.id],
      event.id,
    );

    const claimable = await listClaimableEventListenerDeliveries(
      testDatabase.db,
      repository.id,
      10,
    );

    expect(claimable).toHaveLength(1);
    expect(claimable[0]?.delivery.id).toBe(pending.id);
    expect(claimable[0]?.listenerEnabled).toBe(true);
    expect(claimable[0]?.agentId).toBe(testAgent.id);
    expect(claimable[0]?.agentEnabled).toBe(true);
  });

  it('excludes rows already running, succeeded, failed, or abandoned', async () => {
    const { user, repository, listener, event } = await createFixture();
    const [pending] = await insertPendingEventListenerDeliveries(
      testDatabase.db,
      [listener.id],
      event.id,
    );
    await claimEventListenerDelivery(testDatabase.db, pending.id);
    await insertTribunalRun({ id: 'run_1', userId: user.id, repositoryId: repository.id });
    await markEventListenerDeliverySucceeded(testDatabase.db, pending.id, 'run_1');

    const claimable = await listClaimableEventListenerDeliveries(
      testDatabase.db,
      repository.id,
      10,
    );
    expect(claimable).toHaveLength(0);
  });

  it('reflects a listener disabled between matching and drain', async () => {
    const { repository, listener, event, user } = await createFixture();
    const [pending] = await insertPendingEventListenerDeliveries(
      testDatabase.db,
      [listener.id],
      event.id,
    );

    const { setEventListenerEnabled } = await import('../event-listeners');
    await setEventListenerEnabled(testDatabase.db, user.id, repository.id, listener.id, false);

    const claimable = await listClaimableEventListenerDeliveries(
      testDatabase.db,
      repository.id,
      10,
    );
    expect(claimable).toHaveLength(1);
    expect(claimable[0]?.delivery.id).toBe(pending.id);
    expect(claimable[0]?.listenerEnabled).toBe(false);
  });

  it('reflects an agent disabled between matching and drain', async () => {
    const { repository, listener, event, testAgent } = await createFixture();
    await insertPendingEventListenerDeliveries(testDatabase.db, [listener.id], event.id);

    await testDatabase.db.update(agent).set({ enabled: false }).where(eq(agent.id, testAgent.id));

    const claimable = await listClaimableEventListenerDeliveries(
      testDatabase.db,
      repository.id,
      10,
    );
    expect(claimable).toHaveLength(1);
    expect(claimable[0]?.agentEnabled).toBe(false);
  });
});

describe('deriveEventListenerDisplayStatus', () => {
  it('maps an unclaimed or claimed-but-undispatched delivery to matched', () => {
    expect(deriveEventListenerDisplayStatus('pending', null)).toBe('matched');
    expect(deriveEventListenerDisplayStatus('running', null)).toBe('matched');
  });

  it('maps a retryable, abandoned, or failed dispatch to failed', () => {
    expect(deriveEventListenerDisplayStatus('retryable', null)).toBe('failed');
    expect(deriveEventListenerDisplayStatus('abandoned', null)).toBe('failed');
    expect(deriveEventListenerDisplayStatus('failed', null)).toBe('failed');
  });

  it('reflects the spawned run status once dispatch succeeds', () => {
    expect(deriveEventListenerDisplayStatus('succeeded', 'queued')).toBe('queued');
    expect(deriveEventListenerDisplayStatus('succeeded', 'running')).toBe('running');
    expect(deriveEventListenerDisplayStatus('succeeded', 'posted')).toBe('succeeded');
    expect(deriveEventListenerDisplayStatus('succeeded', 'superseded')).toBe('succeeded');
    expect(deriveEventListenerDisplayStatus('succeeded', 'cancelled')).toBe('cancelled');
    expect(deriveEventListenerDisplayStatus('succeeded', 'failed')).toBe('failed');
    expect(deriveEventListenerDisplayStatus('succeeded', 'quota_blocked')).toBe('failed');
  });

  it('defaults to queued for a succeeded dispatch with no resolvable run status', () => {
    expect(deriveEventListenerDisplayStatus('succeeded', null)).toBe('queued');
  });
});
