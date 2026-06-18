import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { runWithDatabase } from '$lib/server/database';
import {
  agent,
  agentEvent,
  agentRun,
  costEvent,
  githubInstallation,
  githubInstallationRepository,
  repository,
  repositoryAgent,
  repositoryReviewSettings,
  reviewRun,
  user,
} from '@tribunal/database/schema';
import { eq } from 'drizzle-orm';
import { getCostOverview, getRunInspector, saveRepositoryWatchSettings, stopRun } from './operator';

describe('review operator server helpers', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  function withTestDatabase<T>(operation: () => Promise<T>): Promise<T> {
    return runWithDatabase(testDb.db as never, operation);
  }

  async function seedRepositoryOwnership() {
    const [owner] = await testDb.db.insert(user).values({ username: 'owner-user' }).returning();
    const [otherUser] = await testDb.db.insert(user).values({ username: 'other-user' }).returning();
    await testDb.db.insert(repository).values({
      id: 9001,
      owner: 'lost-gradient',
      name: 'tribunal',
      uri: 'https://github.com/lost-gradient/tribunal.git',
      defaultBranch: 'main',
    });
    await testDb.db.insert(githubInstallation).values({
      installationId: 7001,
      userId: owner.id,
      accountLogin: 'lost-gradient',
      accountType: 'Organization',
      accountId: 7002,
      repositorySelection: 'selected',
    });
    await testDb.db.insert(githubInstallationRepository).values({
      installationId: 7001,
      repositoryId: 9001,
      isActive: true,
    });
    const [reviewAgent] = await testDb.db
      .insert(agent)
      .values({
        id: 'agent_security',
        userId: owner.id,
        slug: 'security',
        description: 'Finds security issues',
        body: 'Review for security issues.',
        model: 'sonnet',
        enabled: true,
      })
      .returning();

    return { owner, otherUser, reviewAgent };
  }

  it('persists repository watch settings only for the owning user', async () => {
    const { owner, otherUser, reviewAgent } = await seedRepositoryOwnership();

    await withTestDatabase(() =>
      saveRepositoryWatchSettings(owner.id, {
        repositoryId: 9001,
        watched: true,
        ignoreGlobs: ['docs/**'],
        agentIds: [reviewAgent.id],
      }),
    );

    const [settings] = await testDb.db
      .select()
      .from(repositoryReviewSettings)
      .where(eq(repositoryReviewSettings.repositoryId, 9001));
    const assignments = await testDb.db.select().from(repositoryAgent);

    expect(settings).toMatchObject({ watched: true, ignoreGlobs: ['docs/**'] });
    expect(assignments).toHaveLength(1);
    await expect(
      withTestDatabase(() =>
        saveRepositoryWatchSettings(otherUser.id, {
          repositoryId: 9001,
          watched: false,
          ignoreGlobs: [],
          agentIds: [],
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('scopes run inspection and stop control to the owning user', async () => {
    const { owner, otherUser, reviewAgent } = await seedRepositoryOwnership();
    await testDb.db.insert(reviewRun).values({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 12,
      headSha: 'abc123',
      trigger: 'opened',
      status: 'running',
      startedAt: new Date('2026-06-17T12:00:00Z'),
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_1',
      userId: owner.id,
      reviewRunId: 'run_1',
      agentId: reviewAgent.id,
      status: 'running',
    });
    await testDb.db.insert(agentEvent).values({
      agentRunId: 'agent_run_1',
      seq: 1,
      kind: 'tool_pre',
      tool: 'Read',
      detail: { denied: true, reason: 'outside repository' },
    });

    const inspected = await withTestDatabase(() => getRunInspector(owner.id, 'run_1'));
    expect(inspected.agentRuns[0]?.events[0]?.detail).toMatchObject({ denied: true });
    await expect(
      withTestDatabase(() => getRunInspector(otherUser.id, 'run_1')),
    ).rejects.toMatchObject({ status: 404 });
    await expect(withTestDatabase(() => stopRun(otherUser.id, 'run_1'))).rejects.toMatchObject({
      status: 403,
    });

    await withTestDatabase(() => stopRun(owner.id, 'run_1'));
    const [stoppedRun] = await testDb.db.select().from(reviewRun).where(eq(reviewRun.id, 'run_1'));
    expect(stoppedRun.status).toBe('cancelled');
  });

  it('rolls up estimated costs and cache-token splits', async () => {
    const { owner, reviewAgent } = await seedRepositoryOwnership();
    await testDb.db.insert(reviewRun).values({
      id: 'run_cost',
      userId: owner.id,
      repositoryId: 9001,
      prNumber: 22,
      headSha: 'def456',
      trigger: 'manual',
      status: 'posted',
    });
    await testDb.db.insert(agentRun).values({
      id: 'agent_run_cost',
      userId: owner.id,
      reviewRunId: 'run_cost',
      agentId: reviewAgent.id,
      status: 'succeeded',
    });
    await testDb.db.insert(costEvent).values({
      id: 'cost_1',
      userId: owner.id,
      kind: 'llm',
      source: 'estimate',
      repositoryId: 9001,
      reviewRunId: 'run_cost',
      agentRunId: 'agent_run_cost',
      agentId: reviewAgent.id,
      amountUsd: '1.25',
      idempotencyKey: 'cost_1',
      meta: { cacheReadTokens: 20, cacheCreationTokens: 10 },
    });

    const overview = await withTestDatabase(() => getCostOverview(owner.id, 'estimate'));

    expect(overview.rollups.byKind).toEqual([{ label: 'llm', amountUsd: 1.25 }]);
    expect(overview.rollups.byAgent).toEqual([{ label: 'security', amountUsd: 1.25 }]);
    expect(overview.cacheTokens).toEqual({ cacheReadTokens: 20, cacheCreationTokens: 10 });
  });
});
