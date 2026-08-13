import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, resetIdCounter } from '@tribunal/test/factories';
import { eq, and } from '../../operators';
import {
  agent,
  costBudgetDay,
  costReservation,
  githubInstallation,
  oauthConnection,
  pullRequestState,
  pullRequestActionItem,
  repository,
  repositoryEventListener,
  repositoryReviewSettings,
  userReviewSettings,
  workflowRun,
} from '../index';

/**
 * Every table with an `updatedAt` column wires up Drizzle's `$onUpdate(() =>
 * new Date())`, which only runs when the ORM issues an UPDATE -- never on
 * insert, and never merely by importing the schema module. These tests prove
 * the auto-bump actually fires: insert a row with `updatedAt` pinned to a
 * fixed date far in the past, update an unrelated column, then confirm the
 * re-read row's `updatedAt` moved forward from that pinned value.
 */
describe('schema $onUpdate auto-bumped timestamps', () => {
  let testDatabase: TestDatabase;
  const distantPast = new Date('2000-01-01T00:00:00.000Z');

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

  it('bumps repository.updatedAt on update', async () => {
    const factories = createFactories(testDatabase.db);
    const repo = await factories.repository.create();
    await testDatabase.db
      .update(repository)
      .set({ updatedAt: distantPast })
      .where(eq(repository.id, repo.id));

    await testDatabase.db
      .update(repository)
      .set({ defaultBranch: 'develop' })
      .where(eq(repository.id, repo.id));

    const [updated] = await testDatabase.db
      .select()
      .from(repository)
      .where(eq(repository.id, repo.id));

    expect(updated.defaultBranch).toBe('develop');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(distantPast.getTime());
  });

  it('bumps agent.updatedAt on update', async () => {
    const factories = createFactories(testDatabase.db);
    const user = await factories.user.create();
    const [created] = await testDatabase.db
      .insert(agent)
      .values({
        id: 'agent_bump',
        userId: user.id,
        slug: 'agent-bump',
        description: 'Test agent',
        body: 'Do the thing.',
        updatedAt: distantPast,
      })
      .returning();

    await testDatabase.db.update(agent).set({ enabled: false }).where(eq(agent.id, created.id));

    const [updated] = await testDatabase.db.select().from(agent).where(eq(agent.id, created.id));

    expect(updated.enabled).toBe(false);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(distantPast.getTime());
  });

  it('bumps githubInstallation.updatedAt on update', async () => {
    const factories = createFactories(testDatabase.db);
    const user = await factories.user.create();
    const installation = await factories.githubInstallation.createForUser(user.id);
    await testDatabase.db
      .update(githubInstallation)
      .set({ updatedAt: distantPast })
      .where(eq(githubInstallation.id, installation.id));

    await testDatabase.db
      .update(githubInstallation)
      .set({ status: 'suspended' })
      .where(eq(githubInstallation.id, installation.id));

    const [updated] = await testDatabase.db
      .select()
      .from(githubInstallation)
      .where(eq(githubInstallation.id, installation.id));

    expect(updated.status).toBe('suspended');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(distantPast.getTime());
  });

  it('bumps oauthConnection.updatedAt on update', async () => {
    const factories = createFactories(testDatabase.db);
    const user = await factories.user.create();
    const connection = await factories.oauthConnection.create({ userId: user.id });
    await testDatabase.db
      .update(oauthConnection)
      .set({ updatedAt: distantPast })
      .where(eq(oauthConnection.id, connection.id));

    await testDatabase.db
      .update(oauthConnection)
      .set({ status: 'invalid' })
      .where(eq(oauthConnection.id, connection.id));

    const [updated] = await testDatabase.db
      .select()
      .from(oauthConnection)
      .where(eq(oauthConnection.id, connection.id));

    expect(updated.status).toBe('invalid');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(distantPast.getTime());
  });

  it('bumps userReviewSettings.updatedAt on update', async () => {
    const factories = createFactories(testDatabase.db);
    const user = await factories.user.create();
    await testDatabase.db.insert(userReviewSettings).values({
      userId: user.id,
      updatedAt: distantPast,
    });

    await testDatabase.db
      .update(userReviewSettings)
      .set({ reviewsEnabled: false })
      .where(eq(userReviewSettings.userId, user.id));

    const [updated] = await testDatabase.db
      .select()
      .from(userReviewSettings)
      .where(eq(userReviewSettings.userId, user.id));

    expect(updated.reviewsEnabled).toBe(false);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(distantPast.getTime());
  });

  it('bumps costBudgetDay.updatedAt on update', async () => {
    const factories = createFactories(testDatabase.db);
    const user = await factories.user.create();
    await testDatabase.db.insert(costBudgetDay).values({
      userId: user.id,
      dayStartedAt: new Date('2026-06-17T00:00:00.000Z'),
      updatedAt: distantPast,
    });

    await testDatabase.db
      .update(costBudgetDay)
      .set({ reservedUsd: '0.01' })
      .where(eq(costBudgetDay.userId, user.id));

    const [updated] = await testDatabase.db
      .select()
      .from(costBudgetDay)
      .where(eq(costBudgetDay.userId, user.id));

    expect(updated.reservedUsd).toBe('0.01');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(distantPast.getTime());
  });

  it('bumps costReservation.updatedAt on update', async () => {
    const factories = createFactories(testDatabase.db);
    const user = await factories.user.create();
    await testDatabase.db.insert(costBudgetDay).values({
      userId: user.id,
      dayStartedAt: new Date('2026-06-17T00:00:00.000Z'),
    });
    const [reservation] = await testDatabase.db
      .insert(costReservation)
      .values({
        id: 'cost_reservation_bump',
        userId: user.id,
        dayStartedAt: new Date('2026-06-17T00:00:00.000Z'),
        idempotencyKey: 'llm:reservation-bump',
        amountUsd: '0.01',
        expiresAt: new Date('2026-06-17T13:00:00.000Z'),
        createdAt: new Date('2026-06-17T12:00:00.000Z'),
        updatedAt: distantPast,
      })
      .returning();

    await testDatabase.db
      .update(costReservation)
      .set({ releasedAt: new Date('2026-06-17T12:30:00.000Z') })
      .where(eq(costReservation.id, reservation.id));

    const [updated] = await testDatabase.db
      .select()
      .from(costReservation)
      .where(eq(costReservation.id, reservation.id));

    expect(updated.releasedAt).toEqual(new Date('2026-06-17T12:30:00.000Z'));
    expect(updated.updatedAt.getTime()).toBeGreaterThan(distantPast.getTime());
  });

  it('bumps repositoryReviewSettings.updatedAt on update', async () => {
    const factories = createFactories(testDatabase.db);
    const user = await factories.user.create();
    const repo = await factories.repository.create();
    await testDatabase.db.insert(repositoryReviewSettings).values({
      userId: user.id,
      repositoryId: repo.id,
      updatedAt: distantPast,
    });

    await testDatabase.db
      .update(repositoryReviewSettings)
      .set({ watched: true })
      .where(
        and(
          eq(repositoryReviewSettings.userId, user.id),
          eq(repositoryReviewSettings.repositoryId, repo.id),
        ),
      );

    const [updated] = await testDatabase.db
      .select()
      .from(repositoryReviewSettings)
      .where(
        and(
          eq(repositoryReviewSettings.userId, user.id),
          eq(repositoryReviewSettings.repositoryId, repo.id),
        ),
      );

    expect(updated.watched).toBe(true);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(distantPast.getTime());
  });

  it('bumps repositoryEventListener.updatedAt on update', async () => {
    const factories = createFactories(testDatabase.db);
    const user = await factories.user.create();
    const repo = await factories.repository.create();
    const [testAgent] = await testDatabase.db
      .insert(agent)
      .values({
        id: 'agent_listener_bump',
        userId: user.id,
        slug: 'agent-listener-bump',
        description: 'Test agent',
        body: 'Do the thing.',
      })
      .returning();

    const [listener] = await testDatabase.db
      .insert(repositoryEventListener)
      .values({
        id: 'listener_bump',
        userId: user.id,
        repositoryId: repo.id,
        name: 'Bump listener',
        eventType: 'issues',
        agentId: testAgent.id,
        updatedAt: distantPast,
      })
      .returning();

    await testDatabase.db
      .update(repositoryEventListener)
      .set({ enabled: false })
      .where(eq(repositoryEventListener.id, listener.id));

    const [updated] = await testDatabase.db
      .select()
      .from(repositoryEventListener)
      .where(eq(repositoryEventListener.id, listener.id));

    expect(updated.enabled).toBe(false);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(distantPast.getTime());
  });

  it('bumps pullRequestState.updatedAt on update', async () => {
    const factories = createFactories(testDatabase.db);
    const repo = await factories.repository.create();
    const [state] = await testDatabase.db
      .insert(pullRequestState)
      .values({
        repositoryId: repo.id,
        prNumber: 1,
        updatedAt: distantPast,
      })
      .returning();

    await testDatabase.db
      .update(pullRequestState)
      .set({ isDraft: true })
      .where(eq(pullRequestState.id, state.id));

    const [updated] = await testDatabase.db
      .select()
      .from(pullRequestState)
      .where(eq(pullRequestState.id, state.id));

    expect(updated.isDraft).toBe(true);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(distantPast.getTime());
  });

  it('bumps pullRequestActionItem.updatedAt on update', async () => {
    const factories = createFactories(testDatabase.db);
    const repo = await factories.repository.create();
    const [state] = await testDatabase.db
      .insert(pullRequestState)
      .values({ repositoryId: repo.id, prNumber: 2 })
      .returning();

    const [item] = await testDatabase.db
      .insert(pullRequestActionItem)
      .values({
        pullRequestStateId: state.id,
        stableKey: 'ci-check-lint',
        subject: 'Fix lint failure',
        updatedAt: distantPast,
      })
      .returning();

    await testDatabase.db
      .update(pullRequestActionItem)
      .set({ status: 'done' })
      .where(eq(pullRequestActionItem.id, item.id));

    const [updated] = await testDatabase.db
      .select()
      .from(pullRequestActionItem)
      .where(eq(pullRequestActionItem.id, item.id));

    expect(updated.status).toBe('done');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(distantPast.getTime());
  });

  it('bumps workflowRun.updatedAt on update', async () => {
    const factories = createFactories(testDatabase.db);
    const created = await factories.workflowRun.create({ workspaceId: 1 });
    await testDatabase.db
      .update(workflowRun)
      .set({ updatedAt: distantPast })
      .where(eq(workflowRun.id, created.id));

    await testDatabase.db
      .update(workflowRun)
      .set({ phase: 'completed' })
      .where(eq(workflowRun.id, created.id));

    const [updated] = await testDatabase.db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.id, created.id));

    expect(updated.phase).toBe('completed');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(distantPast.getTime());
  });
});
