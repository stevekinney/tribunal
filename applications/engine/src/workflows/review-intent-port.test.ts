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
import { createDatabaseReviewIntentPort, getReviewIntentQueueStatus } from './review-intent-port';

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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);
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

  it("carries the user's stored default_model onto the claimed review workflow input", async () => {
    const { user, repository } = await createReviewIntentFixture({ defaultModel: 'opus' });
    await testDatabase.db.insert(agent).values({
      id: 'agent_security',
      userId: user.id,
      slug: 'security-review',
      description: 'Reviews security changes.',
      body: 'Find security problems.',
      model: 'inherit',
      effort: 'high',
    });
    await testDatabase.db.insert(repositoryAgent).values({
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);

    const claimed = await port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z'));

    expect(claimed?.pullRequest.defaultModel).toBe('opus');
  });

  it('carries the intent-supplied Check Run id onto the claimed review workflow input', async () => {
    const { user, repository } = await createReviewIntentFixture({ checkRunId: 5551234 });
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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);

    const claimed = await port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z'));

    expect(claimed?.pullRequest.checkRunId).toBe(5551234);
  });

  it('omits checkRunId from the claimed review workflow input when the intent predates it', async () => {
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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);

    const claimed = await port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z'));

    expect(claimed?.pullRequest.checkRunId).toBeUndefined();
  });

  it('defaults checkConclusionMode to advisory on the claimed review workflow input', async () => {
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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);

    const claimed = await port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z'));

    expect(claimed?.pullRequest.checkConclusionMode).toBe('advisory');
  });

  it('carries a gating checkConclusionMode onto the claimed review workflow input', async () => {
    const { user, repository } = await createReviewIntentFixture({ checkConclusionMode: 'gating' });
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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);

    const claimed = await port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z'));

    expect(claimed?.pullRequest.checkConclusionMode).toBe('gating');
  });

  it('leaves unwatched review intents unclaimed', async () => {
    await createReviewIntentFixture({ watched: false });
    const port = createDatabaseReviewIntentPort(testDatabase.db);

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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db, {
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
      orderBy: () => selectBuilder,
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
            userId: 1,
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
    const port = createDatabaseReviewIntentPort(database as never);

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
      { userId: user.id, repositoryId: repository.id, agentId: 'agent_active' },
      { userId: inactiveUser.id, repositoryId: repository.id, agentId: 'agent_inactive' },
    ]);
    const port = createDatabaseReviewIntentPort(testDatabase.db);

    const claimed = await port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z'));

    expect(claimed?.pullRequest).toMatchObject({
      userId: user.id,
      installationId: 1001,
      agents: [{ id: 'agent_active' }],
    });
  });

  it('prefers the repository installation when multiple active installations are linked', async () => {
    const { user, repository } = await createReviewIntentFixture();
    const factories = createFactories(testDatabase.db);
    const otherUser = await factories.user.create();
    const otherInstallation = await factories.githubInstallation.createForUser(otherUser.id, {
      installationId: 1000,
      status: 'active',
    });
    await testDatabase.db.insert(githubInstallationRepository).values({
      installationId: otherInstallation.installationId,
      repositoryId: repository.id,
      isActive: true,
    });
    await testDatabase.db.insert(userReviewSettings).values({
      userId: otherUser.id,
      dailyCostCapUsd: '1.00',
      reviewsEnabled: true,
    });
    await testDatabase.db.insert(agent).values([
      {
        id: 'agent_repository_installation',
        userId: user.id,
        slug: 'repository-installation-review',
        description: 'Reviews for the repository installation.',
        body: 'Use this agent.',
        model: 'claude-sonnet-4-6',
      },
      {
        id: 'agent_other_installation',
        userId: otherUser.id,
        slug: 'other-installation-review',
        description: 'Should not be selected.',
        body: 'Do not use.',
        model: 'claude-sonnet-4-6',
      },
    ]);
    await testDatabase.db.insert(repositoryAgent).values([
      { userId: user.id, repositoryId: repository.id, agentId: 'agent_repository_installation' },
      { userId: otherUser.id, repositoryId: repository.id, agentId: 'agent_other_installation' },
    ]);
    const port = createDatabaseReviewIntentPort(testDatabase.db);

    const claimed = await port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z'));

    expect(claimed?.pullRequest).toMatchObject({
      userId: user.id,
      installationId: 1001,
      agents: [{ id: 'agent_repository_installation' }],
    });
  });

  it('builds review input for the watched user when the repository installation user is unwatched', async () => {
    const { user, repository } = await createReviewIntentFixture({ watched: false });
    const factories = createFactories(testDatabase.db);
    const watchedUser = await factories.user.create();
    const watchedInstallation = await factories.githubInstallation.createForUser(watchedUser.id, {
      installationId: 1000,
      status: 'active',
    });
    await testDatabase.db.insert(githubInstallationRepository).values({
      installationId: watchedInstallation.installationId,
      repositoryId: repository.id,
      isActive: true,
    });
    await testDatabase.db.insert(userReviewSettings).values({
      userId: watchedUser.id,
      dailyCostCapUsd: '1.00',
      reviewsEnabled: true,
    });
    await testDatabase.db.insert(repositoryReviewSettings).values({
      userId: watchedUser.id,
      repositoryId: repository.id,
      watched: true,
      ignoreGlobs: ['watched-user/**'],
    });
    await testDatabase.db
      .update(reviewIntent)
      .set({ userId: watchedUser.id })
      .where(eq(reviewIntent.id, 'intent_1'));
    await testDatabase.db.insert(agent).values([
      {
        id: 'agent_unwatched_installation',
        userId: user.id,
        slug: 'unwatched-installation-review',
        description: 'Should not be selected.',
        body: 'Do not use.',
        model: 'claude-sonnet-4-6',
      },
      {
        id: 'agent_watched_installation',
        userId: watchedUser.id,
        slug: 'watched-installation-review',
        description: 'Reviews for the watched installation.',
        body: 'Use this agent.',
        model: 'claude-sonnet-4-6',
      },
    ]);
    await testDatabase.db.insert(repositoryAgent).values([
      { userId: user.id, repositoryId: repository.id, agentId: 'agent_unwatched_installation' },
      {
        userId: watchedUser.id,
        repositoryId: repository.id,
        agentId: 'agent_watched_installation',
      },
    ]);
    const port = createDatabaseReviewIntentPort(testDatabase.db);

    const claimed = await port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z'));

    expect(claimed?.pullRequest).toMatchObject({
      userId: watchedUser.id,
      installationId: 1000,
      ignoreGlobs: ['watched-user/**'],
      agents: [{ id: 'agent_watched_installation' }],
    });
  });

  it('claims one review intent for each watched user on a shared repository', async () => {
    const { user, repository } = await createReviewIntentFixture();
    const factories = createFactories(testDatabase.db);
    const otherUser = await factories.user.create();
    const otherInstallation = await factories.githubInstallation.createForUser(otherUser.id, {
      installationId: 1000,
      status: 'active',
    });
    await testDatabase.db.insert(githubInstallationRepository).values({
      installationId: otherInstallation.installationId,
      repositoryId: repository.id,
      isActive: true,
    });
    await testDatabase.db.insert(userReviewSettings).values({
      userId: otherUser.id,
      dailyCostCapUsd: '5.00',
      reviewsEnabled: true,
    });
    await testDatabase.db.insert(repositoryReviewSettings).values({
      userId: otherUser.id,
      repositoryId: repository.id,
      watched: true,
      ignoreGlobs: ['other-user/**'],
    });
    await testDatabase.db.insert(reviewIntent).values({
      id: 'intent_2',
      deliveryId: 'delivery_1',
      kind: 'start',
      repositoryId: repository.id,
      userId: otherUser.id,
      prNumber: 7,
      headSha: null,
    });
    await testDatabase.db.insert(agent).values([
      {
        id: 'agent_primary_user',
        userId: user.id,
        slug: 'primary-user-review',
        description: 'Reviews for the primary user.',
        body: 'Use primary user.',
        model: 'claude-sonnet-4-6',
      },
      {
        id: 'agent_other_user',
        userId: otherUser.id,
        slug: 'other-user-review',
        description: 'Reviews for the other user.',
        body: 'Use other user.',
        model: 'claude-sonnet-4-6',
      },
    ]);
    await testDatabase.db.insert(repositoryAgent).values([
      { userId: user.id, repositoryId: repository.id, agentId: 'agent_primary_user' },
      { userId: otherUser.id, repositoryId: repository.id, agentId: 'agent_other_user' },
    ]);
    const port = createDatabaseReviewIntentPort(testDatabase.db);
    const firstClaimedAt = new Date('2026-06-17T12:00:00.000Z');
    const secondClaimedAt = new Date('2026-06-17T12:01:00.000Z');

    const first = await port.claimNextReviewIntent(firstClaimedAt);
    await port.markReviewIntentProcessed(first!.id, first!.claimedAt, secondClaimedAt);
    const second = await port.claimNextReviewIntent(secondClaimedAt);

    expect(first?.pullRequest).toMatchObject({
      userId: user.id,
      agents: [{ id: 'agent_primary_user' }],
    });
    expect(second?.pullRequest).toMatchObject({
      userId: otherUser.id,
      ignoreGlobs: ['other-user/**'],
      agents: [{ id: 'agent_other_user' }],
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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    await testDatabase.db
      .update(reviewIntent)
      .set({ claimedAt: new Date('2026-06-17T11:50:00.000Z') })
      .where(eq(reviewIntent.id, 'intent_1'));
    const port = createDatabaseReviewIntentPort(testDatabase.db);

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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    await testDatabase.db
      .update(reviewIntent)
      .set({ claimedAt: new Date('2026-06-17T12:00:00.000Z') })
      .where(eq(reviewIntent.id, 'intent_1'));
    const port = createDatabaseReviewIntentPort(testDatabase.db);

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

  it('reports ready and deferred queue status for eligible review intents', async () => {
    const { user, repository } = await createReviewIntentFixture();
    await testDatabase.db.insert(reviewIntent).values({
      id: 'intent_2',
      deliveryId: 'delivery_2',
      kind: 'start',
      repositoryId: repository.id,
      userId: user.id,
      prNumber: 8,
      headSha: null,
      nextAttemptAt: new Date('2026-06-17T12:05:00.000Z'),
    });

    await expect(
      getReviewIntentQueueStatus(testDatabase.db, new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toEqual({
      readyCount: 1,
      deferredCount: 1,
      claimedCount: 0,
      nextAttemptAt: new Date('2026-06-17T12:05:00.000Z'),
    });
  });

  it('reports active claimed review intents separately from claimable work', async () => {
    await createReviewIntentFixture();
    await testDatabase.db
      .update(reviewIntent)
      .set({ claimedAt: new Date('2026-06-17T12:00:00.000Z') })
      .where(eq(reviewIntent.id, 'intent_1'));

    await expect(
      getReviewIntentQueueStatus(testDatabase.db, new Date('2026-06-17T12:02:00.000Z')),
    ).resolves.toEqual({
      readyCount: 0,
      deferredCount: 0,
      claimedCount: 1,
    });
  });

  it('reports an empty queue when reviews are globally disabled', async () => {
    await createReviewIntentFixture();

    await expect(
      getReviewIntentQueueStatus(testDatabase.db, new Date('2026-06-17T12:00:00.000Z'), {
        reviewsEnabled: false,
      }),
    ).resolves.toEqual({
      readyCount: 0,
      deferredCount: 0,
      claimedCount: 0,
    });
  });

  it('normalizes raw queue status count shapes from database drivers', async () => {
    const now = new Date('2026-06-17T12:00:00.000Z');
    const nextAttemptAt = '2026-06-17T12:05:00.000Z';

    await expect(
      getReviewIntentQueueStatus(
        {
          execute: async () => ({
            rows: [{ readyCount: '2', deferredCount: 1n, claimedCount: '3', nextAttemptAt }],
          }),
        } as never,
        now,
      ),
    ).resolves.toEqual({
      readyCount: 2,
      deferredCount: 1,
      claimedCount: 3,
      nextAttemptAt: new Date(nextAttemptAt),
    });

    await expect(
      getReviewIntentQueueStatus(
        {
          execute: async () => ({ rows: [{}] }),
        } as never,
        now,
      ),
    ).resolves.toEqual({
      readyCount: 0,
      deferredCount: 0,
      claimedCount: 0,
    });

    await expect(
      getReviewIntentQueueStatus(
        {
          execute: async () => ({
            rows: [
              {
                readyCount: 'not-a-count',
                deferredCount: Number.NaN,
                claimedCount: 'Infinity',
              },
            ],
          }),
        } as never,
        now,
      ),
    ).resolves.toEqual({
      readyCount: 0,
      deferredCount: 0,
      claimedCount: 0,
    });
  });

  it('clears previous failure state when a retry is processed', async () => {
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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    await testDatabase.db
      .update(reviewIntent)
      .set({ claimedAt: new Date('2026-06-17T12:00:00.000Z') })
      .where(eq(reviewIntent.id, 'intent_1'));
    const port = createDatabaseReviewIntentPort(testDatabase.db);

    await port.markReviewIntentFailed(
      'intent_1',
      new Date('2026-06-17T12:00:00.000Z'),
      new Date('2026-06-17T12:01:00.000Z'),
      new Error('temporary failure'),
    );
    const claimed = await port.claimNextReviewIntent(new Date('2026-06-17T12:02:00.000Z'));

    await expect(
      port.markReviewIntentProcessed(
        'intent_1',
        claimed!.claimedAt,
        new Date('2026-06-17T12:03:00.000Z'),
      ),
    ).resolves.toBe(true);

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      processedAt: new Date('2026-06-17T12:03:00.000Z'),
      failedAt: null,
      failureCount: 0,
      lastError: null,
      nextAttemptAt: null,
      deadLetteredAt: null,
    });
  });

  it('does not clear processed review intents after a late failure', async () => {
    await createReviewIntentFixture();
    const claimedAt = new Date('2026-06-17T12:00:00.000Z');
    const processedAt = new Date('2026-06-17T12:01:00.000Z');
    await testDatabase.db
      .update(reviewIntent)
      .set({ claimedAt })
      .where(eq(reviewIntent.id, 'intent_1'));
    const port = createDatabaseReviewIntentPort(testDatabase.db);

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
    const port = createDatabaseReviewIntentPort(testDatabase.db);

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

  it('falls back to all enabled user agents when no repository assignment rows exist', async () => {
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
    const port = createDatabaseReviewIntentPort(testDatabase.db);

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toMatchObject({
      pullRequest: {
        agents: [{ id: 'agent_security' }],
      },
    });
  });

  it('releases watched intents when all explicitly assigned repository agents are disabled', async () => {
    const { user, repository } = await createReviewIntentFixture();
    await testDatabase.db.insert(agent).values([
      {
        id: 'agent_disabled',
        userId: user.id,
        slug: 'disabled-review',
        description: 'Disabled.',
        body: 'Skip.',
        model: 'claude-sonnet-4-6',
        enabled: false,
      },
      {
        id: 'agent_unassigned',
        userId: user.id,
        slug: 'unassigned-review',
        description: 'Unassigned.',
        body: 'Do not fall back.',
        model: 'claude-sonnet-4-6',
      },
    ]);
    await testDatabase.db.insert(repositoryAgent).values({
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_disabled',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);

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

  it('does not overwrite an eligible-agent wait that was cleared after claim', async () => {
    const { user } = await createReviewIntentFixture();
    await testDatabase.db
      .update(reviewIntent)
      .set({
        lastError: 'Review intent is waiting for an eligible review agent.',
        nextAttemptAt: new Date('2026-06-17T11:59:00.000Z'),
      })
      .where(eq(reviewIntent.id, 'intent_1'));
    const database = {
      execute: testDatabase.db.execute.bind(testDatabase.db),
      select: testDatabase.db.select.bind(testDatabase.db),
      update: ((table) => {
        const update = testDatabase.db.update(table);
        return {
          set(values: Record<string, unknown>) {
            const setBuilder = update.set(values);
            if (
              table === reviewIntent &&
              values.lastError === 'Review intent is waiting for an eligible review agent.'
            ) {
              return {
                async where(condition: Parameters<typeof setBuilder.where>[0]) {
                  await testDatabase.db
                    .update(reviewIntent)
                    .set({
                      claimedAt: null,
                      failedAt: null,
                      lastError: null,
                      nextAttemptAt: null,
                    })
                    .where(eq(reviewIntent.id, 'intent_1'));
                  return setBuilder.where(condition);
                },
              };
            }
            return setBuilder;
          },
        };
      }) as typeof testDatabase.db.update,
    };
    const port = createDatabaseReviewIntentPort(database);

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toBeNull();

    const [intent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(intent).toMatchObject({
      userId: user.id,
      claimedAt: null,
      failedAt: null,
      lastError: null,
      nextAttemptAt: null,
    });
  });

  it('continues claiming later eligible intents after releasing an intent with disabled assignments', async () => {
    const { user, installation, repository } = await createReviewIntentFixture();
    const factories = createFactories(testDatabase.db);
    const secondRepository = await factories.repository.create({
      id: 43,
      owner: 'lostgradient',
      name: 'tribunal-docs',
      installationId: installation.installationId,
    });
    await testDatabase.db.insert(githubInstallationRepository).values({
      installationId: installation.installationId,
      repositoryId: secondRepository.id,
      isActive: true,
    });
    await testDatabase.db.insert(repositoryReviewSettings).values({
      userId: user.id,
      repositoryId: secondRepository.id,
      watched: true,
      ignoreGlobs: [],
      checkConclusionMode: 'advisory',
    });
    await testDatabase.db.insert(pullRequestState).values({
      repositoryId: secondRepository.id,
      prNumber: 8,
      state: 'open',
      headSha: 'b'.repeat(40),
    });
    await testDatabase.db.insert(reviewIntent).values({
      id: 'intent_2',
      deliveryId: 'delivery_2',
      kind: 'start',
      repositoryId: secondRepository.id,
      userId: user.id,
      prNumber: 8,
      headSha: null,
    });
    await testDatabase.db.insert(agent).values([
      {
        id: 'agent_disabled',
        userId: user.id,
        slug: 'disabled-review',
        description: 'Disabled.',
        body: 'Skip.',
        model: 'claude-sonnet-4-6',
        enabled: false,
      },
      {
        id: 'agent_unassigned',
        userId: user.id,
        slug: 'unassigned-review',
        description: 'Unassigned.',
        body: 'Review repositories without explicit assignments.',
        model: 'claude-sonnet-4-6',
      },
    ]);
    await testDatabase.db.insert(repositoryAgent).values({
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_disabled',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toMatchObject({
      id: 'intent_2',
      pullRequest: {
        repositoryId: secondRepository.id,
        agents: [{ id: 'agent_unassigned' }],
      },
    });

    const [deferredIntent] = await testDatabase.db
      .select()
      .from(reviewIntent)
      .where(eq(reviewIntent.id, 'intent_1'));
    expect(deferredIntent).toMatchObject({
      claimedAt: null,
      processedAt: null,
      lastError: 'Review intent is waiting for an eligible review agent.',
      nextAttemptAt: new Date('2026-06-17T12:01:00.000Z'),
    });
  });

  it('omits eligible-agent waits from queue status so persistent configuration gaps do not pin idle engines', async () => {
    const { user, repository } = await createReviewIntentFixture();
    await testDatabase.db.insert(agent).values({
      id: 'agent_disabled',
      userId: user.id,
      slug: 'disabled-review',
      description: 'Disabled.',
      body: 'Skip.',
      model: 'claude-sonnet-4-6',
      enabled: false,
    });
    await testDatabase.db.insert(repositoryAgent).values({
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_disabled',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toBeNull();

    await expect(
      getReviewIntentQueueStatus(testDatabase.db, new Date('2026-06-17T12:01:00.000Z')),
    ).resolves.toEqual({
      readyCount: 0,
      deferredCount: 0,
      claimedCount: 0,
    });
  });

  it('bounds deferred-intent scanning per claim while leaving remaining ready work visible', async () => {
    const { user, repository } = await createReviewIntentFixture();
    await testDatabase.db.insert(agent).values({
      id: 'agent_disabled',
      userId: user.id,
      slug: 'disabled-review',
      description: 'Disabled.',
      body: 'Skip.',
      model: 'claude-sonnet-4-6',
      enabled: false,
    });
    await testDatabase.db.insert(repositoryAgent).values({
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_disabled',
    });
    await testDatabase.db.insert(pullRequestState).values([
      {
        repositoryId: repository.id,
        prNumber: 8,
        state: 'open',
        headSha: 'b'.repeat(40),
      },
      {
        repositoryId: repository.id,
        prNumber: 9,
        state: 'open',
        headSha: 'c'.repeat(40),
      },
    ]);
    await testDatabase.db.insert(reviewIntent).values([
      {
        id: 'intent_2',
        deliveryId: 'delivery_2',
        kind: 'start',
        repositoryId: repository.id,
        userId: user.id,
        prNumber: 8,
      },
      {
        id: 'intent_3',
        deliveryId: 'delivery_3',
        kind: 'start',
        repositoryId: repository.id,
        userId: user.id,
        prNumber: 9,
      },
    ]);
    const now = new Date('2026-06-17T12:00:00.000Z');
    const port = createDatabaseReviewIntentPort(testDatabase.db, {
      maxSkippedReviewIntentsPerClaim: 2,
    });

    await expect(port.claimNextReviewIntent(now)).resolves.toBeNull();

    const intents = await testDatabase.db.select().from(reviewIntent).orderBy(reviewIntent.id);
    expect(intents).toMatchObject([
      {
        id: 'intent_1',
        claimedAt: null,
        lastError: 'Review intent is waiting for an eligible review agent.',
        nextAttemptAt: new Date('2026-06-17T12:01:00.000Z'),
      },
      {
        id: 'intent_2',
        claimedAt: null,
        lastError: 'Review intent is waiting for an eligible review agent.',
        nextAttemptAt: new Date('2026-06-17T12:01:00.000Z'),
      },
      {
        id: 'intent_3',
        claimedAt: null,
        lastError: null,
        nextAttemptAt: null,
      },
    ]);
    await expect(getReviewIntentQueueStatus(testDatabase.db, now)).resolves.toMatchObject({
      readyCount: 1,
      deferredCount: 0,
      claimedCount: 0,
    });
  });

  it('uses the default deferred scan bound when the configured bound is non-positive', async () => {
    const { user, repository } = await createReviewIntentFixture();
    await testDatabase.db.insert(agent).values({
      id: 'agent_disabled',
      userId: user.id,
      slug: 'disabled-review',
      description: 'Disabled.',
      body: 'Skip.',
      model: 'claude-sonnet-4-6',
      enabled: false,
    });
    await testDatabase.db.insert(repositoryAgent).values({
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_disabled',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db, {
      maxSkippedReviewIntentsPerClaim: 0,
    });

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toBeNull();

    expect(port.consumeSkippedReviewIntentLimitReached?.()).toBe(false);
  });

  it('releases watched intents without any eligible agents for retry', async () => {
    await createReviewIntentFixture();
    const port = createDatabaseReviewIntentPort(testDatabase.db);

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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);

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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);
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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);
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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toMatchObject({
      kind: 'pr_closed',
      pullRequest: { trigger: 'manual', agents: [{ id: 'agent_security' }] },
    });
  });

  it('claims closed intents without requiring eligible review agents', async () => {
    await createReviewIntentFixture({ kind: 'pr_closed' });
    const port = createDatabaseReviewIntentPort(testDatabase.db);

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
      userId: user.id,
      repositoryId: repository.id,
      agentId: 'agent_security',
    });
    const port = createDatabaseReviewIntentPort(testDatabase.db);

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
    const port = createDatabaseReviewIntentPort({
      execute: async () => [],
    } as never);

    await expect(
      port.claimNextReviewIntent(new Date('2026-06-17T12:00:00.000Z')),
    ).resolves.toBeNull();
  });

  it('returns null for unsupported raw execute results', async () => {
    const port = createDatabaseReviewIntentPort({
      execute: async () => ({}),
    } as never);

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
    checkRunId?: number;
    checkConclusionMode?: 'advisory' | 'gating';
    defaultModel?: string;
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
    ...(options.defaultModel !== undefined ? { defaultModel: options.defaultModel } : {}),
  });
  await testDatabase.db.insert(repositoryReviewSettings).values({
    userId: user.id,
    repositoryId: repository.id,
    watched: options.watched ?? true,
    ignoreGlobs: ['docs/**'],
    checkConclusionMode: options.checkConclusionMode ?? 'advisory',
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
    userId: user.id,
    prNumber: 7,
    headSha: null,
    checkRunId: options.checkRunId ?? null,
  });

  return { user, installation, repository };
}
