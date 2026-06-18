import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from '@tribunal/database/operators';
import {
  agent,
  githubInstallationRepository,
  pullRequestState,
  repositoryAgent,
  repositoryReviewSettings,
  reviewIntent,
  userReviewSettings,
} from '@tribunal/database/schema';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, resetIdCounter } from '@tribunal/test/factories';
import { createDatabaseReviewIntentPort } from './review-intent-port';

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

describe('createDatabaseReviewIntentPort', () => {
  it('claims the oldest watched review intent and builds review workflow input', async () => {
    const { user, repository } = await createReviewIntentFixture();
    await testDatabase.db.insert(agent).values({
      id: 'agent_security',
      userId: user.id,
      slug: 'security-review',
      description: 'Reviews security changes.',
      body: 'Find security problems.',
      model: 'claude-sonnet-4-6',
      effort: 'high',
    });
    await testDatabase.db.insert(repositoryAgent).values({
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });
    const now = new Date('2026-06-17T12:00:00.000Z');

    const claimed = await port.claimNextReviewIntent(now);

    expect(claimed).toMatchObject({
      id: 'intent_1',
      kind: 'start',
      deliveryId: 'delivery_1',
      claimedAt: now,
      pullRequest: {
        userId: user.id,
        repositoryId: repository.id,
        installationId: 1001,
        repository: { owner: 'lostgradient', name: 'tribunal' },
        pullRequestNumber: 7,
        headSha: 'a'.repeat(40),
        trigger: 'opened',
        dailyCostCapUsd: 25,
        agents: [
          {
            id: 'agent_security',
            slug: 'security-review',
            effort: 'high',
            enabled: true,
          },
        ],
      },
    });

    await port.markReviewIntentProcessed('intent_1', new Date('2026-06-17T12:01:00.000Z'));
    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent?.processedAt).toEqual(new Date('2026-06-17T12:01:00.000Z'));
  });

  it('leaves unwatched review intents unclaimed', async () => {
    await createReviewIntentFixture({ watched: false });
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toBeNull();

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent?.claimedAt).toBeNull();
  });

  it('reclaims stale unprocessed review intents', async () => {
    const { user, repository } = await createReviewIntentFixture();
    await testDatabase.db.insert(agent).values({
      id: 'agent_security',
      userId: user.id,
      slug: 'security-review',
      description: 'Reviews security changes.',
      body: 'Find security problems.',
      model: 'claude-sonnet-4-6',
    });
    await testDatabase.db.insert(repositoryAgent).values({
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    await testDatabase.db
      .update(reviewIntent)
      .set({ claimedAt: new Date('2026-06-17T11:50:00.000Z') })
      .where(eq(reviewIntent.id, 'intent_1'));
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toMatchObject({ id: 'intent_1', claimedAt: new Date('2026-06-17T12:00:00.000Z') });
  });

  it('releases a failed unprocessed review intent for retry', async () => {
    await createReviewIntentFixture();
    await testDatabase.db
      .update(reviewIntent)
      .set({ claimedAt: new Date('2026-06-17T12:00:00.000Z') })
      .where(eq(reviewIntent.id, 'intent_1'));
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });

    await port.markReviewIntentFailed(
      'intent_1',
      new Date('2026-06-17T12:01:00.000Z'),
      new Error('check run creation failed'),
    );

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({ claimedAt: null, processedAt: null });
  });

  it('marks watched intents without assigned agents processed without returning work', async () => {
    await createReviewIntentFixture();
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toBeNull();

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent?.processedAt).toEqual(new Date('2026-06-17T12:00:00.000Z'));
  });

  it('maps closed intents to manual workflow triggers', async () => {
    const { user, repository } = await createReviewIntentFixture({ kind: 'pr_closed' });
    await testDatabase.db.insert(agent).values({
      id: 'agent_security',
      userId: user.id,
      slug: 'security-review',
      description: 'Reviews security changes.',
      body: 'Find security problems.',
      model: 'claude-sonnet-4-6',
    });
    await testDatabase.db.insert(repositoryAgent).values({
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toMatchObject({
      kind: 'pr_closed',
      pullRequest: { trigger: 'manual', agents: [{ id: 'agent_security' }] },
    });
  });

  it('maps commit intents to synchronize workflow triggers and prefers the intent head SHA', async () => {
    const { user, repository } = await createReviewIntentFixture({ kind: 'commit_pushed' });
    await testDatabase.db
      .update(reviewIntent)
      .set({ headSha: 'b'.repeat(40) })
      .where(eq(reviewIntent.id, 'intent_1'));
    await testDatabase.db.insert(agent).values({
      id: 'agent_security',
      userId: user.id,
      slug: 'security-review',
      description: 'Reviews security changes.',
      body: 'Find security problems.',
      model: 'claude-sonnet-4-6',
    });
    await testDatabase.db.insert(repositoryAgent).values({
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toMatchObject({
      kind: 'commit_pushed',
      pullRequest: {
        headSha: 'b'.repeat(40),
        trigger: 'synchronize',
        agents: [{ id: 'agent_security', enabled: true }],
      },
    });
  });

  it('reads raw execute array results when claiming intents', async () => {
    const port = createDatabaseReviewIntentPort(
      {
        execute: async () => [],
      } as never,
      { defaultDailyCostCapUsd: 25 },
    );

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toBeNull();
  });

  it('returns null for unsupported raw execute results', async () => {
    const port = createDatabaseReviewIntentPort(
      {
        execute: async () => ({}),
      } as never,
      { defaultDailyCostCapUsd: 25 },
    );

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toBeNull();
  });
});

async function createReviewIntentFixture(
  options: { watched?: boolean; kind?: 'start' | 'commit_pushed' | 'pr_closed' } = {},
) {
  const factories = createFactories(testDatabase.db);
  const user = await factories.user.create();
  const installation = await factories.githubInstallation.createForUser(user.id, {
    installationId: 1001,
  });
  const repository = await factories.repository.create({
    id: 42,
    owner: 'lostgradient',
    name: 'tribunal',
    installationId: installation.installationId,
  });

  await testDatabase.db.insert(githubInstallationRepository).values({
    installationId: installation.installationId,
    repositoryId: repository.id,
    isActive: true,
  });
  await testDatabase.db.insert(userReviewSettings).values({
    userId: user.id,
    dailyCostCapUsd: '25.00',
    reviewsEnabled: true,
  });
  await testDatabase.db.insert(repositoryReviewSettings).values({
    repositoryId: repository.id,
    watched: options.watched ?? true,
  });
  await testDatabase.db.insert(pullRequestState).values({
    repositoryId: repository.id,
    prNumber: 7,
    state: 'open',
    headSha: 'a'.repeat(40),
  });
  await testDatabase.db.insert(reviewIntent).values({
    id: 'intent_1',
    deliveryId: 'delivery_1',
    kind: options.kind ?? 'start',
    repositoryId: repository.id,
    prNumber: 7,
    headSha: null,
  });

  return { user, installation, repository };
}
