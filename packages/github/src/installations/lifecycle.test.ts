import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, type AllFactories } from '@tribunal/test/factories';
import {
  githubInstallationRepository,
  pullRequestState,
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

describe('handleInstallationDeleted', () => {
  it('cancels active workflows, the installation sync workflow, and deletes the installation', async () => {
    const installation = await factories.githubInstallation.create({ installationId: 7001 });
    const repository = await factories.repository.create({ installationId: 7001 });
    await factories.workflowRun.createForRepository(1, repository.id, { phase: 'executing' });

    const cancel = vi.fn().mockResolvedValue(undefined);
    const context = createContext({
      resolveWeftClient: vi.fn().mockResolvedValue({ cancel }),
    });

    await handleInstallationDeleted(context, installation.installationId);

    expect(cancel).toHaveBeenCalledWith(`github:installations:${installation.installationId}:sync`);

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

  it('treats an unresolvable engine as nothing-to-cancel and still deletes the installation', async () => {
    const installation = await factories.githubInstallation.create({ installationId: 7009 });
    const context = createContext({
      resolveWeftClient: vi.fn().mockRejectedValue(new Error('engine unavailable')),
    });

    await handleInstallationDeleted(context, installation.installationId);

    const remaining = await getInstallationById(context, installation.installationId);
    expect(remaining).toBeNull();
  });

  it('treats a missing sync workflow as nothing-to-cancel and still deletes the installation', async () => {
    const installation = await factories.githubInstallation.create({ installationId: 7008 });
    const notFoundError = Object.assign(new Error('missing'), { code: 'WorkflowNotFoundError' });
    const cancel = vi.fn().mockRejectedValue(notFoundError);
    const context = createContext({
      resolveWeftClient: vi.fn().mockResolvedValue({ cancel }),
    });

    await handleInstallationDeleted(context, installation.installationId);

    expect(cancel).toHaveBeenCalledWith(`github:installations:${installation.installationId}:sync`);
    const remaining = await getInstallationById(context, installation.installationId);
    expect(remaining).toBeNull();
  });
});

describe('handleInstallationSuspend', () => {
  it('marks the installation suspended with the given reason', async () => {
    const installation = await factories.githubInstallation.create({ installationId: 7003 });
    const context = createContext();

    await handleInstallationSuspend(context, installation.installationId, 'Billing issue');

    const updated = await getInstallationById(context, installation.installationId);
    expect(updated?.status).toBe('suspended');
    expect(updated?.statusReason).toBe('Billing issue');
  });

  it('defaults the reason and logs active workflows without cancelling them', async () => {
    const installation = await factories.githubInstallation.create({ installationId: 7004 });
    const repository = await factories.repository.create({ installationId: 7004 });
    await factories.workflowRun.createForRepository(1, repository.id, { phase: 'executing' });
    const context = createContext();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await handleInstallationSuspend(context, installation.installationId);

    const updated = await getInstallationById(context, installation.installationId);
    expect(updated?.status).toBe('suspended');
    expect(updated?.statusReason).toBe('Suspended by GitHub');

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
    const installation = await factories.githubInstallation.create({ installationId: 7007 });
    const repository = await factories.repository.create({ installationId: 7007 });
    await testDatabase.db.insert(githubInstallationRepository).values({
      installationId: installation.installationId,
      repositoryId: repository.id,
    });
    await factories.workflowRun.createForRepository(1, repository.id, { phase: 'pending' });
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
    expect(link.removedAt).not.toBeNull();

    const [run] = await testDatabase.db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.repositoryId, repository.id));
    expect(run.phase).toBe('cancelled');
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

  it('cancels workflow_run rows and ported PR orchestrators by their stable id', async () => {
    const repository = await factories.repository.create();
    await factories.workflowRun.createForRepository(1, repository.id, { phase: 'cloning' });
    await testDatabase.db.insert(pullRequestState).values({
      repositoryId: repository.id,
      prNumber: 42,
      state: 'open',
    });
    const cancel = vi.fn().mockResolvedValue(undefined);
    const context = createContext({
      resolveWeftClient: vi.fn().mockResolvedValue({ cancel }),
    });

    const result = await cancelWorkflowsForRepositories(
      context,
      [repository.id],
      'repository_removed',
    );

    expect(result.cancelled).toBe(2);
    expect(result.failed).toBe(0);
    expect(cancel).toHaveBeenCalledTimes(2);
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

  it('counts a genuine PR orchestrator cancellation failure in the aggregated result', async () => {
    const repository = await factories.repository.create();
    await testDatabase.db.insert(pullRequestState).values({
      repositoryId: repository.id,
      prNumber: 99,
      state: 'open',
    });
    const cancel = vi.fn().mockRejectedValue(new Error('orchestrator unreachable'));
    const context = createContext({
      resolveWeftClient: vi.fn().mockResolvedValue({ cancel }),
    });

    const result = await cancelWorkflowsForRepositories(context, [repository.id], 'test');

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
