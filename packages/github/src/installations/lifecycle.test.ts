import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, type AllFactories } from '@tribunal/test/factories';
import {
  githubInstallationRepository,
  pullRequestReviewRun,
  reviewIntent,
  tribunalRun,
  workflowRun,
} from '@tribunal/database/schema';
import type { Database } from '@tribunal/database';
import type { GithubServiceContext } from '../context.js';
import {
  cancelWorkflowsForRepositories,
  handleInstallationDeleted,
  handleInstallationSuspend,
  handleInstallationUnsuspend,
  handleRepositoriesRemoved,
} from './lifecycle.js';
import { getInstallationById } from './records.js';

let testDatabase: TestDatabase;
let factories: AllFactories;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  factories = createFactories(testDatabase.db);
});

afterAll(async () => {
  await testDatabase.close();
});

beforeEach(async () => {
  await testDatabase.reset();
});

/** Build a GithubServiceContext backed by the real PGlite test database. */
function createContext(overrides: Partial<GithubServiceContext> = {}): GithubServiceContext {
  return {
    db: testDatabase.db as Database,
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
    getGithubApplication: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

async function createActiveReview(userId: number, repositoryId: number, prNumber: number) {
  const runId = `review:${userId}:${repositoryId}:${prNumber}`;
  await testDatabase.db.insert(tribunalRun).values({
    id: runId,
    userId,
    repositoryId,
    runKind: 'pull_request_review',
    status: 'running',
    workflowId: `review:pr:${repositoryId}:${prNumber}`,
  });
  await testDatabase.db.insert(pullRequestReviewRun).values({
    runId,
    userId,
    repositoryId,
    prNumber,
    headSha: 'abc123',
    trigger: 'opened',
  });
}

describe('handleInstallationDeleted', () => {
  it('cancels active workflows, the installation sync workflow, and deletes the installation', async () => {
    const owner = await factories.user.create();
    const installation = await factories.githubInstallation.create({
      installationId: 7001,
      userId: owner.id,
    });
    const repository = await factories.repository.create({ installationId: 7001 });
    await factories.workflowRun.createForRepository(owner.id, repository.id, {
      phase: 'executing',
      triggeredByUserId: owner.id,
    });

    const cancel = vi.fn().mockResolvedValue(undefined);
    const cancelInstallationSync = vi.fn().mockResolvedValue(undefined);
    const context = createContext({
      resolveWeftClient: vi.fn().mockResolvedValue({ cancel }),
      cancelInstallationSync,
    });

    await handleInstallationDeleted(context, installation.installationId);

    expect(cancelInstallationSync).toHaveBeenCalledWith(installation.installationId);

    const [run] = await testDatabase.db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.repositoryId, repository.id));
    expect(run.phase).toBe('cancelled');

    const remaining = await getInstallationById(context, installation.installationId);
    expect(remaining).toBeNull();
  });

  it('deletes the installation even when it has no repositories', async () => {
    const installation = await factories.githubInstallation.create({ installationId: 7002 });
    const context = createContext();

    await handleInstallationDeleted(context, installation.installationId);

    const remaining = await getInstallationById(context, installation.installationId);
    expect(remaining).toBeNull();
  });

  it('does not delete the installation when engine-owned sync cancellation fails', async () => {
    const installation = await factories.githubInstallation.create({ installationId: 7009 });
    const context = createContext({
      cancelInstallationSync: vi.fn().mockRejectedValue(new Error('engine unavailable')),
    });

    await expect(handleInstallationDeleted(context, installation.installationId)).rejects.toThrow(
      'engine unavailable',
    );

    const remaining = await getInstallationById(context, installation.installationId);
    expect(remaining).not.toBeNull();
  });

  it('does not delete the installation when review cancellation fails', async () => {
    const owner = await factories.user.create();
    const installation = await factories.githubInstallation.create({
      installationId: 7011,
      userId: owner.id,
    });
    const repository = await factories.repository.create({ installationId: 7011 });
    await createActiveReview(owner.id, repository.id, 7);
    const context = createContext({
      cancelWorkflowsById: vi.fn().mockResolvedValue({
        cancelled: 0,
        failed: 1,
        errors: [`review:pr:${repository.id}:7: engine unavailable`],
      }),
    });

    await expect(handleInstallationDeleted(context, installation.installationId)).rejects.toThrow(
      'engine unavailable',
    );

    const remaining = await getInstallationById(context, installation.installationId);
    expect(remaining).not.toBeNull();
  });
});

describe('handleInstallationSuspend', () => {
  it('marks the installation suspended', async () => {
    const installation = await factories.githubInstallation.create({ installationId: 7003 });
    const context = createContext();

    await handleInstallationSuspend(context, installation.installationId, 'Billing issue');

    const updated = await getInstallationById(context, installation.installationId);
    expect(updated?.status).toBe('suspended');
  });

  it('logs active workflows without cancelling them', async () => {
    const installation = await factories.githubInstallation.create({ installationId: 7004 });
    const repository = await factories.repository.create({ installationId: 7004 });
    await factories.workflowRun.createForRepository(1, repository.id, { phase: 'executing' });
    const context = createContext();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await handleInstallationSuspend(context, installation.installationId);

    const updated = await getInstallationById(context, installation.installationId);
    expect(updated?.status).toBe('suspended');

    const [run] = await testDatabase.db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.repositoryId, repository.id));
    expect(run.phase).toBe('executing');
    expect(warnSpy).toHaveBeenCalledWith(
      '[lifecycle] Installation suspended with active workflows',
      expect.objectContaining({ installationId: installation.installationId }),
    );

    warnSpy.mockRestore();
  });
});

describe('handleInstallationUnsuspend', () => {
  it('marks the installation active', async () => {
    const installation = await factories.githubInstallation.create({
      installationId: 7005,
      status: 'suspended',
    });
    const context = createContext();

    await handleInstallationUnsuspend(context, installation.installationId);

    const updated = await getInstallationById(context, installation.installationId);
    expect(updated?.status).toBe('active');
  });
});

describe('handleRepositoriesRemoved', () => {
  it('returns without doing work when repositoryIds is empty', async () => {
    const context = createContext();

    await expect(handleRepositoriesRemoved(context, 7006, [])).resolves.toBeUndefined();
  });

  it('marks repositories inactive and cancels their active workflows', async () => {
    const owner = await factories.user.create();
    const installation = await factories.githubInstallation.create({
      installationId: 7007,
      userId: owner.id,
    });
    const repository = await factories.repository.create({ installationId: 7007 });
    await testDatabase.db.insert(githubInstallationRepository).values({
      installationId: installation.installationId,
      repositoryId: repository.id,
    });
    await factories.workflowRun.createForRepository(owner.id, repository.id, {
      phase: 'pending',
      triggeredByUserId: owner.id,
    });
    const cancel = vi.fn().mockResolvedValue(undefined);
    const context = createContext({
      resolveWeftClient: vi.fn().mockResolvedValue({ cancel }),
    });

    await handleRepositoriesRemoved(context, installation.installationId, [repository.id]);

    const [link] = await testDatabase.db
      .select()
      .from(githubInstallationRepository)
      .where(eq(githubInstallationRepository.repositoryId, repository.id));
    expect(link.isActive).toBe(false);

    const [run] = await testDatabase.db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.repositoryId, repository.id));
    expect(run.phase).toBe('cancelled');
  });

  it('throws when production remote cancellation cannot be delivered', async () => {
    const owner = await factories.user.create();
    const installation = await factories.githubInstallation.create({
      installationId: 7010,
      userId: owner.id,
    });
    const repository = await factories.repository.create({ installationId: 7010 });
    await testDatabase.db.insert(githubInstallationRepository).values({
      installationId: installation.installationId,
      repositoryId: repository.id,
    });
    await factories.workflowRun.createForRepository(owner.id, repository.id, {
      phase: 'executing',
      triggeredByUserId: owner.id,
    });
    const context = createContext({
      cancelWorkflowsById: vi.fn().mockResolvedValue({
        cancelled: 0,
        failed: 1,
        errors: ['workflow:1:test:1: engine unavailable'],
      }),
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      handleRepositoriesRemoved(context, installation.installationId, [repository.id]),
    ).rejects.toThrow('Failed to cancel 1 workflow');

    const [run] = await testDatabase.db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.repositoryId, repository.id));
    expect(run.phase).toBe('executing');

    errorSpy.mockRestore();
  });
});

describe('cancelWorkflowsForRepositories', () => {
  it('returns zeroed result for an empty repository list', async () => {
    const context = createContext();

    const result = await cancelWorkflowsForRepositories(context, [], 'test');

    expect(result).toEqual({ cancelled: 0, failed: 0, errors: [] });
  });

  it('skips the engine entirely when no workflow_run rows are in a cancellable phase', async () => {
    const repository = await factories.repository.create();
    await factories.workflowRun.createForRepository(1, repository.id, { phase: 'completed' });
    const cancel = vi.fn();
    const context = createContext({
      resolveWeftClient: vi.fn().mockResolvedValue({ cancel }),
    });

    const result = await cancelWorkflowsForRepositories(context, [repository.id], 'test');

    expect(result).toEqual({ cancelled: 0, failed: 0, errors: [] });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancels generic rows locally but refuses user-scoped review cancellation', async () => {
    const owner = await factories.user.create();
    const repository = await factories.repository.create();
    await factories.workflowRun.createForRepository(owner.id, repository.id, {
      phase: 'cloning',
      triggeredByUserId: owner.id,
    });
    await createActiveReview(owner.id, repository.id, 42);
    const cancel = vi.fn().mockResolvedValue(undefined);
    const context = createContext({
      resolveWeftClient: vi.fn().mockResolvedValue({ cancel }),
    });

    const result = await cancelWorkflowsForRepositories(
      context,
      [repository.id],
      'repository_removed',
      owner.id,
    );

    expect(result.cancelled).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('User-scoped workflow cancellation is not configured');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('uses the remote engine cancellation port when production web owns no local Weft client', async () => {
    const owner = await factories.user.create();
    const repository = await factories.repository.create();
    await factories.workflowRun.createForRepository(owner.id, repository.id, {
      phase: 'cloning',
      triggeredByUserId: owner.id,
    });
    await factories.workflowRun.createForRepository(owner.id, repository.id, {
      phase: 'executing',
      triggeredByUserId: owner.id,
    });
    await createActiveReview(owner.id, repository.id, 42);
    const cancelWorkflowsById = vi.fn().mockResolvedValue({
      cancelled: 1,
      failed: 0,
      errors: [],
    });
    const context = createContext({
      cancelWorkflowsById,
    });

    const result = await cancelWorkflowsForRepositories(
      context,
      [repository.id],
      'repository_removed',
      owner.id,
    );

    expect(result.cancelled).toBe(3);
    expect(result.failed).toBe(0);
    expect(cancelWorkflowsById).toHaveBeenCalledWith([
      expect.stringMatching(/^workflow:/),
      expect.stringMatching(/^workflow:/),
    ]);
    expect(cancelWorkflowsById).toHaveBeenCalledWith(
      ['review:pr:' + repository.id + ':42'],
      'repository_removed',
      owner.id,
    );
  });

  it('discovers an idle open-pull-request supervisor from its retained sandbox', async () => {
    const owner = await factories.user.create();
    const repository = await factories.repository.create();
    const runId = `review:${owner.id}:${repository.id}:45`;
    await testDatabase.db.insert(tribunalRun).values({
      id: runId,
      userId: owner.id,
      repositoryId: repository.id,
      runKind: 'pull_request_review',
      status: 'posted',
      workflowId: `review:pr:${repository.id}:45`,
      sandboxId: 'sandbox-idle',
    });
    await testDatabase.db.insert(pullRequestReviewRun).values({
      runId,
      userId: owner.id,
      repositoryId: repository.id,
      prNumber: 45,
      headSha: 'abc123',
      trigger: 'opened',
      checkRunId: 9001,
    });
    const cancelWorkflowsById = vi.fn().mockResolvedValue({
      cancelled: 1,
      failed: 0,
      errors: [],
    });

    await cancelWorkflowsForRepositories(
      createContext({ cancelWorkflowsById }),
      [repository.id],
      'repository_removed',
      owner.id,
    );

    expect(cancelWorkflowsById).toHaveBeenCalledWith(
      [`review:pr:${repository.id}:45`],
      'repository_removed',
      owner.id,
    );
  });

  it('scopes repository removal cancellation to the installation owner', async () => {
    const owner = await factories.user.create();
    const otherOwner = await factories.user.create();
    const repository = await factories.repository.create();
    await createActiveReview(owner.id, repository.id, 42);
    await createActiveReview(otherOwner.id, repository.id, 42);
    await testDatabase.db.insert(reviewIntent).values([
      {
        id: 'claimed_owner_review',
        deliveryId: 'delivery_owner',
        kind: 'start',
        repositoryId: repository.id,
        userId: owner.id,
        prNumber: 43,
        claimedAt: new Date('2026-08-13T18:00:00Z'),
      },
      {
        id: 'claimed_other_owner_review',
        deliveryId: 'delivery_other_owner',
        kind: 'start',
        repositoryId: repository.id,
        userId: otherOwner.id,
        prNumber: 44,
        claimedAt: new Date('2026-08-13T18:00:00Z'),
      },
    ]);
    const ownerWorkflow = await factories.workflowRun.createForRepository(owner.id, repository.id, {
      phase: 'executing',
      triggeredByUserId: owner.id,
    });
    const otherWorkflow = await factories.workflowRun.createForRepository(
      otherOwner.id,
      repository.id,
      { phase: 'executing', triggeredByUserId: otherOwner.id },
    );
    const cancelWorkflowsById = vi.fn().mockImplementation(async (workflowIds: string[]) => ({
      cancelled: workflowIds.length,
      failed: 0,
      errors: [],
    }));
    const context = createContext({ cancelWorkflowsById });

    await cancelWorkflowsForRepositories(context, [repository.id], 'repository_removed', owner.id);

    expect(cancelWorkflowsById).toHaveBeenCalledWith([ownerWorkflow.workflowId]);
    expect(cancelWorkflowsById).toHaveBeenCalledWith(
      [`review:pr:${repository.id}:42`, `review:pr:${repository.id}:43`],
      'repository_removed',
      owner.id,
    );
    const rows = await testDatabase.db.select().from(workflowRun);
    expect(rows.find((run) => run.id === ownerWorkflow.id)?.phase).toBe('cancelled');
    expect(rows.find((run) => run.id === otherWorkflow.id)?.phase).toBe('executing');
  });

  it('scopes workflow cancellation by triggering user rather than workspace id', async () => {
    const owner = await factories.user.create();
    const repository = await factories.repository.create();
    const ownedWorkflow = await factories.workflowRun.createForRepository(9001, repository.id, {
      phase: 'executing',
      triggeredByUserId: owner.id,
    });
    const cancelWorkflowsById = vi.fn().mockResolvedValue({
      cancelled: 1,
      failed: 0,
      errors: [],
    });

    await cancelWorkflowsForRepositories(
      createContext({ cancelWorkflowsById }),
      [repository.id],
      'repository_removed',
      owner.id,
    );

    expect(cancelWorkflowsById).toHaveBeenCalledWith([ownedWorkflow.workflowId]);
  });

  it('does not report success when remote workflow cancellation delivery fails', async () => {
    const repository = await factories.repository.create();
    await factories.workflowRun.createForRepository(1, repository.id, { phase: 'executing' });
    const context = createContext({
      cancelWorkflowsById: vi.fn().mockResolvedValue({
        cancelled: 0,
        failed: 1,
        errors: ['workflow_1: engine unavailable'],
      }),
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await cancelWorkflowsForRepositories(context, [repository.id], 'test');

    expect(result.cancelled).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('engine unavailable');
    const [run] = await testDatabase.db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.repositoryId, repository.id));
    expect(run.phase).toBe('executing');

    errorSpy.mockRestore();
  });

  it('reconciles remote workflow cancellations that succeeded before a sibling failed', async () => {
    const repository = await factories.repository.create();
    const successfulRun = await factories.workflowRun.createForRepository(1, repository.id, {
      phase: 'cloning',
    });
    const failedRun = await factories.workflowRun.createForRepository(1, repository.id, {
      phase: 'executing',
    });
    const context = createContext({
      cancelWorkflowsById: vi.fn().mockResolvedValue({
        cancelled: 1,
        failed: 1,
        errors: [`${failedRun.workflowId}: storage unavailable`],
      }),
    });

    const result = await cancelWorkflowsForRepositories(context, [repository.id], 'test');

    expect(result).toEqual({
      cancelled: 1,
      failed: 1,
      errors: [`${failedRun.workflowId}: storage unavailable`],
    });
    const rows = await testDatabase.db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.repositoryId, repository.id));
    const runsById = new Map(rows.map((run) => [run.id, run]));
    expect(runsById.get(successfulRun.id)).toMatchObject({
      phase: 'cancelled',
      cancellationReason: 'test',
    });
    expect(runsById.get(failedRun.id)).toMatchObject({ phase: 'executing' });
  });

  it('treats a missing workflow as already cancelled and reconciles the row', async () => {
    const repository = await factories.repository.create();
    await factories.workflowRun.createForRepository(1, repository.id, { phase: 'provisioning' });
    const notFoundError = Object.assign(new Error('missing'), { code: 'WorkflowNotFoundError' });
    const cancel = vi.fn().mockRejectedValue(notFoundError);
    const context = createContext({
      resolveWeftClient: vi.fn().mockResolvedValue({ cancel }),
    });

    const result = await cancelWorkflowsForRepositories(context, [repository.id], 'test');

    expect(result.cancelled).toBe(1);
    expect(result.failed).toBe(0);
    const [run] = await testDatabase.db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.repositoryId, repository.id));
    expect(run.phase).toBe('cancelled');
  });

  it('fails user-scoped cancellation when the authenticated engine port is absent', async () => {
    const owner = await factories.user.create();
    const repository = await factories.repository.create();
    await createActiveReview(owner.id, repository.id, 44);
    const context = createContext();

    const result = await cancelWorkflowsForRepositories(context, [repository.id], 'test', owner.id);

    expect(result).toEqual({
      cancelled: 0,
      failed: 1,
      errors: [
        `review:pr:${repository.id}:44: User-scoped workflow cancellation is not configured.`,
      ],
    });
  });

  it('does not fall back to a local engine for user-scoped cancellation', async () => {
    const owner = await factories.user.create();
    const repository = await factories.repository.create();
    await createActiveReview(owner.id, repository.id, 46);
    const context = createContext({
      resolveWeftClient: vi.fn().mockRejectedValue(new Error('engine unavailable')),
    });

    const result = await cancelWorkflowsForRepositories(context, [repository.id], 'test', owner.id);

    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('User-scoped workflow cancellation is not configured');
    expect(context.resolveWeftClient).not.toHaveBeenCalled();
  });

  it('does not use generic local missing-workflow handling for user-scoped cancellation', async () => {
    const owner = await factories.user.create();
    const repository = await factories.repository.create();
    await createActiveReview(owner.id, repository.id, 45);
    const cancel = vi.fn();
    const context = createContext({
      resolveWeftClient: vi.fn().mockResolvedValue({ cancel }),
    });

    const result = await cancelWorkflowsForRepositories(context, [repository.id], 'test', owner.id);

    expect(result.failed).toBe(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('counts a genuine PR orchestrator cancellation failure in the aggregated result', async () => {
    const owner = await factories.user.create();
    const repository = await factories.repository.create();
    await createActiveReview(owner.id, repository.id, 99);
    const context = createContext({
      cancelWorkflowsById: vi.fn().mockResolvedValue({
        cancelled: 0,
        failed: 1,
        errors: [`review:pr:${repository.id}:99: orchestrator unreachable`],
      }),
    });

    const result = await cancelWorkflowsForRepositories(context, [repository.id], 'test', owner.id);

    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('orchestrator unreachable');
  });

  it('counts a genuine cancellation failure without touching the row', async () => {
    const repository = await factories.repository.create();
    await factories.workflowRun.createForRepository(1, repository.id, { phase: 'capturing' });
    const cancel = vi.fn().mockRejectedValue(new Error('weft unavailable'));
    const context = createContext({
      resolveWeftClient: vi.fn().mockResolvedValue({ cancel }),
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await cancelWorkflowsForRepositories(context, [repository.id], 'test');

    expect(result.cancelled).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('weft unavailable');
    const [run] = await testDatabase.db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.repositoryId, repository.id));
    expect(run.phase).toBe('capturing');

    errorSpy.mockRestore();
  });

  it('reconciles rows without an engine when resolveWeftClient is unset', async () => {
    const repository = await factories.repository.create();
    await factories.workflowRun.createForRepository(1, repository.id, { phase: 'executing' });
    const context = createContext();

    const result = await cancelWorkflowsForRepositories(context, [repository.id], 'test');

    expect(result.cancelled).toBe(1);
    const [run] = await testDatabase.db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.repositoryId, repository.id));
    expect(run.phase).toBe('cancelled');
  });

  it('reconciles rows when resolveWeftClient rejects', async () => {
    const repository = await factories.repository.create();
    await factories.workflowRun.createForRepository(1, repository.id, { phase: 'executing' });
    const context = createContext({
      resolveWeftClient: vi.fn().mockRejectedValue(new Error('engine unavailable')),
    });

    const result = await cancelWorkflowsForRepositories(context, [repository.id], 'test');

    expect(result.cancelled).toBe(1);
  });

  it('skips rows that transitioned to a terminal phase between select and update', async () => {
    const repository = await factories.repository.create();
    const run = await factories.workflowRun.createForRepository(1, repository.id, {
      phase: 'executing',
    });
    // The engine cancel resolves first in the real code path; have it race the
    // DB update by flipping the row to a terminal phase before the UPDATE ...
    // WHERE phase IN (cancellable) runs, so the update affects zero rows.
    const cancel = vi.fn().mockImplementation(async () => {
      await testDatabase.db
        .update(workflowRun)
        .set({ phase: 'completed' })
        .where(eq(workflowRun.id, run.id));
    });
    const context = createContext({
      resolveWeftClient: vi.fn().mockResolvedValue({ cancel }),
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await cancelWorkflowsForRepositories(context, [repository.id], 'test');

    expect(result.cancelled).toBe(0);
    expect(result.failed).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      '[lifecycle] Workflow already completed, skipping cancellation',
      expect.objectContaining({ workflowId: run.workflowId }),
    );

    logSpy.mockRestore();
  });
});
