import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import {
  agent,
  agentRun,
  eventListenerDelivery,
  tribunalRun,
  webhookEvent,
  webhookEventHandlerRun,
} from '@tribunal/database/schema';
import {
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

async function createFixture() {
  const user = await testContext.factories.user.create();
  const repository = await testContext.factories.repository.create({ id: 7001 });
  const testAgent = await insertAgent({ id: 'agent_1', userId: user.id });
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
});
