import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestContext, type TestContext } from '@tribunal/test/context';
import { createEventListener, serializeEventListenerFilters } from '@tribunal/database/queries';
import {
  agent,
  eventListenerDelivery,
  githubInstallationRepository,
  webhookEvent,
} from '@tribunal/database/schema';
import type { GithubServiceContext } from '../context.js';
import {
  eventListenerMatchesEvent,
  matchAndPersistEventListenerDeliveries,
} from './event-listener-matching.js';

function baseEvent() {
  return {
    eventType: 'issues',
    action: 'opened' as string | null,
    ref: null as string | null,
    prNumber: null as number | null,
    issueNumber: 7 as number | null,
    senderLogin: 'octocat' as string | null,
  };
}

function baseListener(overrides: Partial<{ action: string | null; filtersJson: string }> = {}) {
  return {
    eventType: 'issues',
    action: overrides.action ?? null,
    filtersJson: overrides.filtersJson ?? '{}',
  };
}

describe('eventListenerMatchesEvent', () => {
  it('does not match a different event type', () => {
    expect(eventListenerMatchesEvent({ ...baseListener(), eventType: 'push' }, baseEvent())).toBe(
      false,
    );
  });

  it('matches when the listener has no action filter', () => {
    expect(eventListenerMatchesEvent(baseListener({ action: null }), baseEvent())).toBe(true);
  });

  it('matches only the exact action when the listener specifies one', () => {
    expect(eventListenerMatchesEvent(baseListener({ action: 'opened' }), baseEvent())).toBe(true);
    expect(eventListenerMatchesEvent(baseListener({ action: 'closed' }), baseEvent())).toBe(false);
  });

  it('matches on a named filter (issueNumber)', () => {
    const filtersJson = serializeEventListenerFilters({ issueNumber: 7 });
    expect(eventListenerMatchesEvent(baseListener({ filtersJson }), baseEvent())).toBe(true);

    const wrongFilters = serializeEventListenerFilters({ issueNumber: 8 });
    expect(
      eventListenerMatchesEvent(baseListener({ filtersJson: wrongFilters }), baseEvent()),
    ).toBe(false);
  });

  it('matches on senderLogin', () => {
    const filtersJson = serializeEventListenerFilters({ senderLogin: 'octocat' });
    expect(eventListenerMatchesEvent(baseListener({ filtersJson }), baseEvent())).toBe(true);

    const wrongFilters = serializeEventListenerFilters({ senderLogin: 'someone-else' });
    expect(
      eventListenerMatchesEvent(baseListener({ filtersJson: wrongFilters }), baseEvent()),
    ).toBe(false);
  });

  it('requires every declared filter to match (AND semantics)', () => {
    const filtersJson = serializeEventListenerFilters({ issueNumber: 7, senderLogin: 'nope' });
    expect(eventListenerMatchesEvent(baseListener({ filtersJson }), baseEvent())).toBe(false);
  });

  it('a listener with an unmatchable ref filter does not match an event with a null ref', () => {
    const filtersJson = serializeEventListenerFilters({ ref: 'refs/heads/main' });
    expect(eventListenerMatchesEvent(baseListener({ filtersJson }), baseEvent())).toBe(false);
  });

  it('fails closed (does not match) when the stored filters_json is malformed', () => {
    expect(eventListenerMatchesEvent(baseListener({ filtersJson: 'not json' }), baseEvent())).toBe(
      false,
    );
  });
});

describe('matchAndPersistEventListenerDeliveries', () => {
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

  async function insertWebhookEvent(input: {
    repositoryId: number;
    eventType?: string;
    action?: string | null;
    issueNumber?: number | null;
  }) {
    const [row] = await testContext.db
      .insert(webhookEvent)
      .values({
        eventType: input.eventType ?? 'issues',
        action: input.action ?? 'opened',
        deliveryId: `delivery-${Math.random()}`,
        payload: '{"issue":{"number":7}}',
        repositoryId: input.repositoryId,
        issueNumber: input.issueNumber ?? 7,
      })
      .returning();
    return row!;
  }

  async function createFixture(options: { filters?: Record<string, unknown> } = {}) {
    const user = await testContext.factories.user.create();
    const repository = await testContext.factories.repository.create({ id: 8001 });
    const [agentRow] = await testContext.db
      .insert(agent)
      .values({
        id: 'agent_matching_1',
        userId: user.id,
        slug: 'agent_matching_1',
        description: 'Test agent',
        body: 'Do the thing.',
        enabled: true,
      })
      .returning();

    const installation = await testContext.factories.githubInstallation.createForUser(user.id, {
      status: 'active',
    });
    await testContext.db.insert(githubInstallationRepository).values({
      installationId: installation.installationId,
      repositoryId: repository.id,
      isActive: true,
    });

    const listener = await createEventListener(testContext.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Listener',
      eventType: 'issues',
      agentId: agentRow!.id,
      instructionsMarkdown: 'Look for duplicates.',
      filters: options.filters,
    });

    return { user, repository, agentRow: agentRow!, listener };
  }

  it('persists a pending delivery for every matched, enabled listener', async () => {
    const { repository, listener } = await createFixture();
    const event = await insertWebhookEvent({ repositoryId: repository.id });
    const context = createGithubContext();

    const inserted = await matchAndPersistEventListenerDeliveries(context, event);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      listenerId: listener.id,
      webhookEventId: event.id,
      status: 'pending',
    });
  });

  it('does not persist a delivery when no enabled listener matches the event', async () => {
    const { repository } = await createFixture({ filters: { issueNumber: 999 } });
    const event = await insertWebhookEvent({ repositoryId: repository.id });
    const context = createGithubContext();

    const inserted = await matchAndPersistEventListenerDeliveries(context, event);

    expect(inserted).toEqual([]);
    const rows = await testContext.db.select().from(eventListenerDelivery);
    expect(rows).toHaveLength(0);
  });

  it('a redelivered webhook re-matching the same listener against the same event is never duplicated', async () => {
    const { repository } = await createFixture();
    const event = await insertWebhookEvent({ repositoryId: repository.id });
    const context = createGithubContext();

    const first = await matchAndPersistEventListenerDeliveries(context, event);
    const redelivery = await matchAndPersistEventListenerDeliveries(context, event);

    expect(first).toHaveLength(1);
    expect(redelivery).toEqual([]);

    const rows = await testContext.db
      .select()
      .from(eventListenerDelivery)
      .where(eq(eventListenerDelivery.webhookEventId, event.id));
    expect(rows).toHaveLength(1);
  });
});
