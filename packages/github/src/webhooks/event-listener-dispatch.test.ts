import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import {
  agent,
  agentRun,
  eventListenerDelivery,
  githubInstallationRepository,
  tribunalRun,
  webhookEvent,
  webhookEventHandlerRun,
} from '@tribunal/database/schema';
import {
  STALE_RUNNING_DELIVERY_TIMEOUT_MS,
  createEventListener,
  insertPendingEventListenerDeliveries,
} from '@tribunal/database/queries';
import type { GithubServiceContext } from '../context.js';
import {
  DEFAULT_EVENT_LISTENER_DRAIN_LIMIT,
  drainEventListenerDeliveries,
} from './event-listener-dispatch.js';

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

async function insertAgent(input: { id: string; userId: number; enabled?: boolean }) {
  const [row] = await testContext.db
    .insert(agent)
    .values({
      id: input.id,
      userId: input.userId,
      slug: input.id,
      description: 'Test agent',
      body: 'Do the thing.',
      enabled: input.enabled ?? true,
    })
    .returning();
  return row;
}

async function insertWebhookEvent(input: { repositoryId: number; eventType?: string }) {
  const [row] = await testContext.db
    .insert(webhookEvent)
    .values({
      eventType: input.eventType ?? 'issues',
      action: 'opened',
      deliveryId: `delivery-${Math.random()}`,
      payload: '{"issue":{"number":1}}',
      repositoryId: input.repositoryId,
    })
    .returning();
  return row;
}

/**
 * Link a user's active GitHub installation to a repository so
 * `isEventListenerOwnerInstallationActive`'s dispatch-time revalidation
 * matches, mirroring the check `listEnabledListenersForRepositoryEventType`
 * already applies at match time.
 */
async function grantActiveInstallationAccess(
  userId: number,
  repositoryId: number,
  options: { installationStatus?: 'active' | 'suspended'; linkActive?: boolean } = {},
) {
  const installation = await testContext.factories.githubInstallation.createForUser(userId, {
    status: options.installationStatus ?? 'active',
  });
  await testContext.db.insert(githubInstallationRepository).values({
    installationId: installation.installationId,
    repositoryId,
    isActive: options.linkActive ?? true,
  });
  return installation;
}

async function createFixture() {
  const user = await testContext.factories.user.create();
  const repository = await testContext.factories.repository.create({ id: 7001 });
  const testAgent = await insertAgent({ id: 'agent_1', userId: user.id });
  await grantActiveInstallationAccess(user.id, repository.id);
  const listener = await createEventListener(testContext.db, {
    userId: user.id,
    repositoryId: repository.id,
    name: 'Listener',
    eventType: 'issues',
    agentId: testAgent.id,
    instructionsMarkdown: 'Look for duplicates.',
  });
  const event = await insertWebhookEvent({ repositoryId: repository.id });
  const [pending] = await insertPendingEventListenerDeliveries(
    testContext.db,
    [listener.id],
    event.id,
  );
  return { user, repository, testAgent, listener, event, pending };
}

describe('drainEventListenerDeliveries', () => {
  it('dispatches a pending delivery: creates a queued tribunal_run, webhook_event_handler_run, and agent_run', async () => {
    const { repository, listener, event, testAgent, pending } = await createFixture();
    const context = createGithubContext(testContext);

    const result = await drainEventListenerDeliveries(context, repository.id);

    expect(result).toEqual({ attempted: 1, dispatched: 1, skippedDisabled: 0, failed: 0 });

    const [deliveryRow] = await testContext.db
      .select()
      .from(eventListenerDelivery)
      .where(eq(eventListenerDelivery.id, pending.id));
    expect(deliveryRow?.status).toBe('succeeded');
    expect(deliveryRow?.runId).not.toBeNull();
    expect(deliveryRow?.attemptCount).toBe(1);

    const [run] = await testContext.db
      .select()
      .from(tribunalRun)
      .where(eq(tribunalRun.id, deliveryRow!.runId!));
    expect(run?.runKind).toBe('webhook_event_handler');
    expect(run?.status).toBe('queued');

    const [handlerDetail] = await testContext.db
      .select()
      .from(webhookEventHandlerRun)
      .where(eq(webhookEventHandlerRun.runId, run!.id));
    expect(handlerDetail?.webhookEventId).toBe(event.id);
    expect(handlerDetail?.eventListenerId).toBe(listener.id);
    expect(handlerDetail?.deliveryId).toBe(pending.id);
    expect(handlerDetail?.eventType).toBe('issues');

    const [createdAgentRun] = await testContext.db
      .select()
      .from(agentRun)
      .where(eq(agentRun.runId, run!.id));
    expect(createdAgentRun?.agentId).toBe(testAgent.id);
    expect(createdAgentRun?.status).toBe('queued');
  });

  it('is bounded to the requested limit', async () => {
    const { repository } = await createFixture();
    const context = createGithubContext(testContext);

    const result = await drainEventListenerDeliveries(context, repository.id, 0);
    expect(result).toEqual({ attempted: 0, dispatched: 0, skippedDisabled: 0, failed: 0 });
  });

  it('defaults the drain limit when not provided', async () => {
    expect(DEFAULT_EVENT_LISTENER_DRAIN_LIMIT).toBeGreaterThan(0);
  });

  it('a redelivered webhook is not re-dispatched: the pending row was never duplicated, and draining twice does nothing the second time', async () => {
    const { repository } = await createFixture();
    const context = createGithubContext(testContext);

    const first = await drainEventListenerDeliveries(context, repository.id);
    expect(first.dispatched).toBe(1);

    const second = await drainEventListenerDeliveries(context, repository.id);
    expect(second).toEqual({ attempted: 0, dispatched: 0, skippedDisabled: 0, failed: 0 });
  });

  it('marks the delivery failed/retryable and skips dispatch when the listener was disabled between matching and drain', async () => {
    const { user, repository, listener, pending } = await createFixture();
    const { setEventListenerEnabled } = await import('@tribunal/database/queries');
    await setEventListenerEnabled(testContext.db, user.id, repository.id, listener.id, false);

    const context = createGithubContext(testContext);
    const result = await drainEventListenerDeliveries(context, repository.id);

    expect(result).toEqual({ attempted: 1, dispatched: 0, skippedDisabled: 1, failed: 0 });

    const [deliveryRow] = await testContext.db
      .select()
      .from(eventListenerDelivery)
      .where(eq(eventListenerDelivery.id, pending.id));
    expect(deliveryRow?.status).toBe('retryable');
    expect(deliveryRow?.lastError).toContain('disabled');

    const runs = await testContext.db.select().from(tribunalRun);
    expect(runs).toHaveLength(0);
  });

  it('marks the delivery failed/retryable and skips dispatch when the agent was disabled between matching and drain', async () => {
    const { repository, testAgent } = await createFixture();
    await testContext.db.update(agent).set({ enabled: false }).where(eq(agent.id, testAgent.id));

    const context = createGithubContext(testContext);
    const result = await drainEventListenerDeliveries(context, repository.id);

    expect(result).toEqual({ attempted: 1, dispatched: 0, skippedDisabled: 1, failed: 0 });
  });

  it('deleting the agent cascades away the listener and delivery entirely -- nothing left to claim', async () => {
    const { repository, testAgent } = await createFixture();
    await testContext.db.delete(agent).where(eq(agent.id, testAgent.id));

    const context = createGithubContext(testContext);
    const result = await drainEventListenerDeliveries(context, repository.id);

    expect(result).toEqual({ attempted: 0, dispatched: 0, skippedDisabled: 0, failed: 0 });

    const remainingDeliveries = await testContext.db.select().from(eventListenerDelivery);
    expect(remainingDeliveries).toHaveLength(0);
  });

  it('reconciles a retry after a partial write without erroring or duplicating: the run/agent_run rows from a crashed first attempt already exist and are simply left in place', async () => {
    const { repository, pending, testAgent } = await createFixture();
    const context = createGithubContext(testContext);

    // Simulate a first dispatch attempt that inserted the parent run and
    // agent_run row (deterministic ids) but crashed before marking the
    // delivery succeeded -- e.g. a process restart between statements,
    // which Neon's HTTP driver (no multi-statement transactions) cannot
    // prevent.
    const runId = `run:webhook:${pending.id}`;
    await testContext.db.insert(tribunalRun).values({
      id: runId,
      userId: (await testContext.db.select().from(agent).where(eq(agent.id, testAgent.id)))[0]!
        .userId,
      repositoryId: repository.id,
      runKind: 'webhook_event_handler',
      status: 'queued',
    });
    await testContext.db.insert(agentRun).values({
      id: `arun:webhook:${pending.id}`,
      userId: (await testContext.db.select().from(agent).where(eq(agent.id, testAgent.id)))[0]!
        .userId,
      runId,
      agentId: testAgent.id,
      role: 'specialist',
      status: 'queued',
    });

    const result = await drainEventListenerDeliveries(context, repository.id);

    expect(result).toEqual({ attempted: 1, dispatched: 1, skippedDisabled: 0, failed: 0 });

    const runs = await testContext.db.select().from(tribunalRun);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe(runId);

    const agentRuns = await testContext.db.select().from(agentRun);
    expect(agentRuns).toHaveLength(1);

    const [deliveryRow] = await testContext.db
      .select()
      .from(eventListenerDelivery)
      .where(eq(eventListenerDelivery.id, pending.id));
    expect(deliveryRow?.status).toBe('succeeded');
    expect(deliveryRow?.runId).toBe(runId);
  });

  it('two concurrent drains for the same repository never double-dispatch the same delivery', async () => {
    const { repository } = await createFixture();
    const context = createGithubContext(testContext);

    const [first, second] = await Promise.all([
      drainEventListenerDeliveries(context, repository.id),
      drainEventListenerDeliveries(context, repository.id),
    ]);

    const totalDispatched = first.dispatched + second.dispatched;
    expect(totalDispatched).toBe(1);

    const runs = await testContext.db.select().from(tribunalRun);
    expect(runs).toHaveLength(1);
  });

  it('a stale pending row from an earlier interrupted drain is picked up by the next drain call (opportunistic re-drain)', async () => {
    const { repository, event, listener } = await createFixture();
    const context = createGithubContext(testContext);

    // First drain succeeds and dispatches the original pending row.
    await drainEventListenerDeliveries(context, repository.id);

    // A second webhook event matches the same listener again, producing a
    // second, independent pending row -- simulating a later delivery that
    // arrives while an earlier one is still queued/in flight.
    const secondEvent = await insertWebhookEvent({ repositoryId: repository.id });
    await insertPendingEventListenerDeliveries(testContext.db, [listener.id], secondEvent.id);

    const secondDrain = await drainEventListenerDeliveries(context, repository.id);
    expect(secondDrain.dispatched).toBe(1);

    const runs = await testContext.db.select().from(tribunalRun);
    expect(runs).toHaveLength(2);
    expect(event.id).not.toBe(secondEvent.id);
  });

  it('drains a backlog larger than a single round within one call', async () => {
    const { repository, listener } = await createFixture();
    const context = createGithubContext(testContext);

    // The fixture already left one pending delivery. Add enough more pending
    // deliveries (against fresh webhook events, since a listener can only
    // have one delivery per event) that the total backlog exceeds
    // `DEFAULT_EVENT_LISTENER_DRAIN_LIMIT` and requires more than one round
    // to fully drain.
    const extraCount = DEFAULT_EVENT_LISTENER_DRAIN_LIMIT * 2;
    for (let i = 0; i < extraCount; i += 1) {
      const extraEvent = await insertWebhookEvent({ repositoryId: repository.id });
      await insertPendingEventListenerDeliveries(testContext.db, [listener.id], extraEvent.id);
    }

    const result = await drainEventListenerDeliveries(context, repository.id);

    expect(result.attempted).toBe(extraCount + 1);
    expect(result.dispatched).toBe(extraCount + 1);

    const remainingPending = await testContext.db
      .select()
      .from(eventListenerDelivery)
      .where(eq(eventListenerDelivery.status, 'pending'));
    expect(remainingPending).toHaveLength(0);
  });

  it('a multi-round drain never attempts the same delivery more than once, even when failures make it re-claimable within the same call', async () => {
    const { repository, listener, testAgent } = await createFixture();
    const context = createGithubContext(testContext);

    // Disable the agent so every dispatch fails with EventListenerDisabledError,
    // which moves the delivery to `retryable` -- itself claimable again.
    // Without per-call dedup, a multi-round drain would re-claim and
    // re-attempt these deliveries in later rounds within the *same* call,
    // burning through the 5-attempt retry cap in seconds instead of across
    // separate webhooks.
    await testContext.db.update(agent).set({ enabled: false }).where(eq(agent.id, testAgent.id));

    const totalCount = DEFAULT_EVENT_LISTENER_DRAIN_LIMIT + 2;
    // The fixture already left one pending delivery -- add enough more to
    // exceed the per-round limit.
    for (let i = 0; i < totalCount - 1; i += 1) {
      const extraEvent = await insertWebhookEvent({ repositoryId: repository.id });
      await insertPendingEventListenerDeliveries(testContext.db, [listener.id], extraEvent.id);
    }

    const result = await drainEventListenerDeliveries(context, repository.id);

    expect(result.attempted).toBe(totalCount);
    expect(result.skippedDisabled).toBe(totalCount);

    const deliveries = await testContext.db.select().from(eventListenerDelivery);
    expect(deliveries).toHaveLength(totalCount);
    for (const delivery of deliveries) {
      expect(delivery.attemptCount).toBe(1);
      expect(delivery.status).toBe('retryable');
    }
  });

  it('a tight per-round limit does not starve unattempted deliveries behind attempted ones (excludeIds pushed into the query)', async () => {
    const { repository, listener, testAgent } = await createFixture();
    const context = createGithubContext(testContext);

    // Disable the agent so every dispatch fails and moves the delivery back
    // to `retryable` -- itself claimable again. With a per-round limit of 1
    // and only in-memory filtering of attempted ids (the pre-fix behavior),
    // round 2 would re-fetch the same (now retryable) row 1, filter it out,
    // end up with zero candidates, and stop -- even though row 2 is still
    // genuinely pending and unattempted.
    await testContext.db.update(agent).set({ enabled: false }).where(eq(agent.id, testAgent.id));

    const secondEvent = await insertWebhookEvent({ repositoryId: repository.id });
    await insertPendingEventListenerDeliveries(testContext.db, [listener.id], secondEvent.id);

    const result = await drainEventListenerDeliveries(
      context,
      repository.id,
      /* limit */ 1,
      /* maxRounds */ 5,
    );

    // Both the original fixture delivery and the second one must be
    // attempted -- neither is starved behind the other by the tight limit.
    expect(result.attempted).toBe(2);
    expect(result.skippedDisabled).toBe(2);

    const deliveries = await testContext.db.select().from(eventListenerDelivery);
    expect(deliveries).toHaveLength(2);
    for (const delivery of deliveries) {
      expect(delivery.attemptCount).toBe(1);
      expect(delivery.status).toBe('retryable');
    }
  });

  it('reclaims a delivery stranded in `running` past the stale timeout, from an earlier crashed/interrupted drain', async () => {
    const { repository, pending } = await createFixture();
    const context = createGithubContext(testContext);

    // Simulate a claim that never completed (process crash between claim
    // and dispatch): the row is `running`, but its `started_at` is older
    // than the stale timeout.
    const staleStartedAt = new Date(Date.now() - STALE_RUNNING_DELIVERY_TIMEOUT_MS - 1000);
    await testContext.db
      .update(eventListenerDelivery)
      .set({ status: 'running', claimedAt: staleStartedAt, startedAt: staleStartedAt })
      .where(eq(eventListenerDelivery.id, pending.id));

    const result = await drainEventListenerDeliveries(context, repository.id);

    expect(result).toEqual({ attempted: 1, dispatched: 1, skippedDisabled: 0, failed: 0 });

    const [deliveryRow] = await testContext.db
      .select()
      .from(eventListenerDelivery)
      .where(eq(eventListenerDelivery.id, pending.id));
    expect(deliveryRow?.status).toBe('succeeded');
    // Reclaiming counts as a new attempt.
    expect(deliveryRow?.attemptCount).toBe(1);
  });

  it('does not reclaim a `running` delivery that has not yet gone stale', async () => {
    const { repository, pending } = await createFixture();
    const context = createGithubContext(testContext);

    const recentStartedAt = new Date();
    await testContext.db
      .update(eventListenerDelivery)
      .set({ status: 'running', claimedAt: recentStartedAt, startedAt: recentStartedAt })
      .where(eq(eventListenerDelivery.id, pending.id));

    const result = await drainEventListenerDeliveries(context, repository.id);

    expect(result).toEqual({ attempted: 0, dispatched: 0, skippedDisabled: 0, failed: 0 });

    const [deliveryRow] = await testContext.db
      .select()
      .from(eventListenerDelivery)
      .where(eq(eventListenerDelivery.id, pending.id));
    expect(deliveryRow?.status).toBe('running');
  });
});
