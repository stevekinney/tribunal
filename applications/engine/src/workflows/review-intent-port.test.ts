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

    await expect(
      port.markReviewIntentProcessed('intent_1', now, new Date('2026-06-17T12:01:00.000Z')),
    ).resolves.toBe(true);
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

  it('leaves ready review intents unclaimed when the global review switch is disabled', async () => {
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
    const port = createDatabaseReviewIntentPort(testDatabase.db, {
      defaultDailyCostCapUsd: 25,
      reviewsEnabled: false,
    });

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toBeNull();

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent?.claimedAt).toBeNull();
  });

  it('marks an intent processed when its target disappears after claim', async () => {
    const updateThenable = {
      set: () => updateThenable,
      where: () => updateThenable,
      then: (resolve: () => void) => resolve(),
    };
    const selectBuilder = {
      from: () => selectBuilder,
      innerJoin: () => selectBuilder,
      leftJoin: () => selectBuilder,
      where: () => selectBuilder,
      limit: () => Promise.resolve([]),
    };
    const database = {
      execute: async () => ({
        rows: [
          {
            id: 'intent_missing_target',
            deliveryId: 'delivery_missing_target',
            kind: 'start',
            repositoryId: 42,
            prNumber: 7,
            headSha: null,
            prState: null,
            createdAt: new Date('2026-06-17T11:59:00.000Z'),
            claimedAt: new Date('2026-06-17T12:00:00.000Z'),
          },
        ],
      }),
      select: () => selectBuilder,
      update: () => updateThenable,
    };
    const port = createDatabaseReviewIntentPort(database as never, { defaultDailyCostCapUsd: 25 });

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toBeNull();
  });

  it('claims workflow input from an active installation when inactive installations are linked', async () => {
    const { user, repository } = await createReviewIntentFixture();
    const factories = createFactories(testDatabase.db);
    const inactiveUser = await factories.user.create();
    const inactiveInstallation = await factories.githubInstallation.createForUser(inactiveUser.id, {
      installationId: 2002,
      status: 'suspended',
    });
    await testDatabase.db.insert(githubInstallationRepository).values({
      installationId: inactiveInstallation.installationId,
      repositoryId: repository.id,
      isActive: true,
    });
    await testDatabase.db.insert(userReviewSettings).values({
      userId: inactiveUser.id,
      dailyCostCapUsd: '1.00',
      reviewsEnabled: true,
    });
    await testDatabase.db.insert(agent).values([
      {
        id: 'agent_active',
        userId: user.id,
        slug: 'active-review',
        description: 'Reviews active installations.',
        body: 'Find active-installation problems.',
        model: 'claude-sonnet-4-6',
      },
      {
        id: 'agent_inactive',
        userId: inactiveUser.id,
        slug: 'inactive-review',
        description: 'Should not be selected.',
        body: 'Do not use.',
        model: 'claude-sonnet-4-6',
      },
    ]);
    await testDatabase.db.insert(repositoryAgent).values([
      { repositoryId: repository.id, agentId: 'agent_active' },
      { repositoryId: repository.id, agentId: 'agent_inactive' },
    ]);
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });

    const claimed = await port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z'));

    expect(claimed?.pullRequest).toMatchObject({
      userId: user.id,
      installationId: 1001,
      agents: [{ id: 'agent_active' }],
    });
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

  it('records a failed unprocessed review intent and backs off retry', async () => {
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
      .set({ claimedAt: new Date('2026-06-17T12:00:00.000Z') })
      .where(eq(reviewIntent.id, 'intent_1'));
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });

    await port.markReviewIntentFailed(
      'intent_1',
      new Date('2026-06-17T12:00:00.000Z'),
      new Date('2026-06-17T12:01:00.000Z'),
      new Error('check run creation failed'),
    );

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      claimedAt: null,
      processedAt: null,
      failedAt: new Date('2026-06-17T12:01:00.000Z'),
      failureCount: 1,
      lastError: 'check run creation failed',
      nextAttemptAt: new Date('2026-06-17T12:02:00.000Z'),
      deadLetteredAt: null,
    });

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:01:30.000Z')),
    ).resolves.toBeNull();
    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:02:00.000Z')),
    ).resolves.toMatchObject({ id: 'intent_1' });
  });

  it('does not clear processed review intents after a late failure', async () => {
    await createReviewIntentFixture();
    const claimedAt = new Date('2026-06-17T12:00:00.000Z');
    const processedAt = new Date('2026-06-17T12:01:00.000Z');
    await testDatabase.db
      .update(reviewIntent)
      .set({ claimedAt })
      .where(eq(reviewIntent.id, 'intent_1'));
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });

    await expect(port.markReviewIntentProcessed('intent_1', claimedAt, processedAt)).resolves.toBe(
      true,
    );
    await port.markReviewIntentFailed(
      'intent_1',
      claimedAt,
      new Date('2026-06-17T12:02:00.000Z'),
      new Error('late failure'),
    );

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      claimedAt,
      processedAt,
      failedAt: null,
      failureCount: 0,
      lastError: null,
      nextAttemptAt: null,
      deadLetteredAt: null,
    });
  });

  it('dead letters review intents after repeated failures', async () => {
    await createReviewIntentFixture();
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });

    for (let index = 0; index < 5; index += 1) {
      await testDatabase.db
        .update(reviewIntent)
        .set({ claimedAt: new Date('2026-06-17T12:00:00.000Z') })
        .where(eq(reviewIntent.id, 'intent_1'));
      await port.markReviewIntentFailed(
        'intent_1',
        new Date('2026-06-17T12:00:00.000Z'),
        new Date(`2026-06-17T12:0${index}:00.000Z`),
        `failure ${index + 1}`,
      );
    }

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      failureCount: 5,
      lastError: 'failure 5',
      nextAttemptAt: null,
      deadLetteredAt: new Date('2026-06-17T12:04:00.000Z'),
    });
    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T13:00:00.000Z')),
    ).resolves.toBeNull();
  });

  it('falls back to all enabled user agents when no repository agents are assigned', async () => {
    const { user } = await createReviewIntentFixture();
    await testDatabase.db.insert(agent).values([
      {
        id: 'agent_security',
        userId: user.id,
        slug: 'security-review',
        description: 'Reviews security changes.',
        body: 'Find security problems.',
        model: 'claude-sonnet-4-6',
      },
      {
        id: 'agent_disabled',
        userId: user.id,
        slug: 'disabled-review',
        description: 'Disabled.',
        body: 'Skip.',
        model: 'claude-sonnet-4-6',
        enabled: false,
      },
    ]);
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toMatchObject({
      pullRequest: {
        agents: [{ id: 'agent_security' }],
      },
    });
  });

  it('releases watched intents without any eligible agents for retry', async () => {
    await createReviewIntentFixture();
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toBeNull();

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      claimedAt: null,
      processedAt: null,
      failureCount: 0,
      lastError: 'Review intent is waiting for an eligible review agent.',
      nextAttemptAt: new Date('2026-06-17T12:01:00.000Z'),
      deadLetteredAt: null,
    });
  });

  it('releases watched intents without a head SHA for retry', async () => {
    const { user, repository } = await createReviewIntentFixture({ createPullRequestState: false });
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
    ).resolves.toBeNull();

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      claimedAt: null,
      processedAt: null,
      failureCount: 0,
      lastError: 'Review intent is waiting for a pull request head SHA.',
      nextAttemptAt: new Date('2026-06-17T12:01:00.000Z'),
      deadLetteredAt: null,
    });
  });

  it('does not let stale claim owners mark reclaimed review intents processed', async () => {
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
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });
    const firstClaimedAt = new Date('2026-06-17T12:00:00.000Z');
    const secondClaimedAt = new Date('2026-06-17T12:06:00.000Z');

    await expect(port.claimNextReviewIntent(firstClaimedAt)).resolves.toMatchObject({
      id: 'intent_1',
      claimedAt: firstClaimedAt,
    });
    await expect(port.claimNextReviewIntent(secondClaimedAt)).resolves.toMatchObject({
      id: 'intent_1',
      claimedAt: secondClaimedAt,
    });
    await expect(
      port.markReviewIntentProcessed(
        'intent_1',
        firstClaimedAt,
        new Date('2026-06-17T12:07:00.000Z'),
      ),
    ).resolves.toBe(false);

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      claimedAt: secondClaimedAt,
      processedAt: null,
      failureCount: 0,
    });
  });

  it('does not let stale claim owners clear a newer claim after failure', async () => {
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
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });
    const firstClaimedAt = new Date('2026-06-17T12:00:00.000Z');
    const secondClaimedAt = new Date('2026-06-17T12:06:00.000Z');

    await expect(port.claimNextReviewIntent(firstClaimedAt)).resolves.toMatchObject({
      id: 'intent_1',
      claimedAt: firstClaimedAt,
    });
    await expect(port.claimNextReviewIntent(secondClaimedAt)).resolves.toMatchObject({
      id: 'intent_1',
      claimedAt: secondClaimedAt,
    });
    await port.markReviewIntentFailed(
      'intent_1',
      firstClaimedAt,
      new Date('2026-06-17T12:07:00.000Z'),
      new Error('stale failure'),
    );

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      claimedAt: secondClaimedAt,
      failedAt: null,
      failureCount: 0,
      lastError: null,
      nextAttemptAt: null,
    });
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

  it('claims closed intents without requiring eligible review agents', async () => {
    await createReviewIntentFixture({ kind: 'pr_closed' });
    const port = createDatabaseReviewIntentPort(testDatabase.db, { defaultDailyCostCapUsd: 25 });

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toMatchObject({
      kind: 'pr_closed',
      pullRequest: { trigger: 'manual', agents: [] },
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
        ignoreGlobs: ['docs/**'],
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
  options: {
    watched?: boolean;
    kind?: 'start' | 'commit_pushed' | 'pr_closed';
    createPullRequestState?: boolean;
  } = {},
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
    ignoreGlobs: ['docs/**'],
  });
  if (options.createPullRequestState !== false) {
    await testDatabase.db.insert(pullRequestState).values({
      repositoryId: repository.id,
      prNumber: 7,
      state: 'open',
      headSha: 'a'.repeat(40),
    });
  }
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
