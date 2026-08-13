import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityContext } from '@lostgradient/weft';
import { TestEngine, yieldToPortableEventLoop } from '@lostgradient/weft/testing';
import type { GithubServiceContext } from '../context.js';
import { createInstallationSyncWorkflow } from './workflow.js';

const refreshInstallationRepositoriesMock = vi.hoisted(() =>
  vi.fn(async () => ({ repositoryCount: 2, deactivatedRepositoryCount: 1 })),
);

vi.mock('../repositories/service.js', () => ({
  refreshInstallationRepositories: refreshInstallationRepositoriesMock,
}));

type TestEngineInstance = InstanceType<typeof TestEngine>;

let engine: TestEngineInstance | undefined;
let releaseRefresh: (() => void) | undefined;

afterEach(async () => {
  releaseRefresh?.();
  releaseRefresh = undefined;
  await engine?.[Symbol.asyncDispose]?.();
  engine = undefined;
  refreshInstallationRepositoriesMock.mockReset();
  refreshInstallationRepositoriesMock.mockResolvedValue({
    repositoryCount: 2,
    deactivatedRepositoryCount: 1,
  });
});

describe('createInstallationSyncWorkflow', () => {
  it('runs the sync activity after debouncing and completes when no later signals arrive', async () => {
    const { installationSyncWorkflow } = createInstallationSyncWorkflow(createGithubContext());
    const testEngine = createTestEngine(installationSyncWorkflow);

    const handle = await testEngine.start(
      'installation-sync',
      { installationId: 42, reason: 'test', workspaceId: 7 },
      { id: 'github:installations:42:sync' },
    );

    await testEngine.advanceTime('15s');
    await yieldToPortableEventLoop();
    await yieldToPortableEventLoop();

    await expect(handle.result()).resolves.toBeUndefined();
    expect(refreshInstallationRepositoriesMock).toHaveBeenCalledWith(
      expect.objectContaining({ db: expect.any(Object) }),
      42,
      expect.objectContaining({
        syncWorkflowExecutionToken: expect.any(String),
        syncActivityAttemptToken: expect.any(String),
      }),
    );
  });

  it('loops when a signal arrives during the repository refresh', async () => {
    refreshInstallationRepositoriesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRefresh = () => resolve({ repositoryCount: 1, deactivatedRepositoryCount: 0 });
        }),
    );
    const { installationSyncWorkflow } = createInstallationSyncWorkflow(createGithubContext());
    const testEngine = createTestEngine(installationSyncWorkflow);

    const handle = await testEngine.start(
      'installation-sync',
      { installationId: 42, reason: 'initial' },
      { id: 'github:installations:42:sync' },
    );

    await testEngine.advanceTime('15s');
    await yieldToPortableEventLoop();
    await testEngine.signal(handle.id, 'sync_requested', { installationId: 42, reason: 'later' });
    releaseRefresh?.();
    releaseRefresh = undefined;
    await yieldToPortableEventLoop();
    await testEngine.advanceTime('15s');
    await yieldToPortableEventLoop();
    await yieldToPortableEventLoop();

    await expect(handle.result()).resolves.toBeUndefined();
    expect(refreshInstallationRepositoriesMock).toHaveBeenCalledTimes(2);
  });

  it('exits the workflow cleanly when repository refresh throws', async () => {
    refreshInstallationRepositoriesMock.mockRejectedValue(new Error('GitHub API unavailable'));
    const { installationSyncWorkflow } = createInstallationSyncWorkflow(createGithubContext());
    const testEngine = createTestEngine(installationSyncWorkflow);

    const handle = await testEngine.start(
      'installation-sync',
      { installationId: 42, reason: 'test' },
      { id: 'github:installations:42:sync' },
    );

    await testEngine.advanceTime('15s');
    await yieldToPortableEventLoop();
    await yieldToPortableEventLoop();

    await expect(handle.result()).resolves.toBeUndefined();
  });

  it('marks the installation in progress before refreshing repositories', async () => {
    const database = createDatabaseRecorder();
    const { syncRepositories } = createInstallationSyncWorkflow(createGithubContext(database));

    await expect(
      syncRepositories(
        { installationId: 42 },
        activityContext({
          workflowExecutionToken: 'workflow-token',
          activityAttemptToken: 'activity-token',
        }),
      ),
    ).resolves.toEqual({ repositoryCount: 2, deactivatedRepositoryCount: 1 });

    expect(database.updates[0]?.set).toMatchObject({
      syncStatus: 'in_progress',
      syncWorkflowExecutionToken: 'workflow-token',
      syncActivityAttemptToken: 'activity-token',
    });
  });

  it('supports direct activity execution without workflow attempt tokens', async () => {
    const database = createDatabaseRecorder();
    const { syncRepositories } = createInstallationSyncWorkflow(createGithubContext(database));

    await expect(syncRepositories({ installationId: 42 }, activityContext())).resolves.toEqual({
      repositoryCount: 2,
      deactivatedRepositoryCount: 1,
    });

    expect(database.updates[0]?.set).toMatchObject({
      syncStatus: 'in_progress',
      syncWorkflowExecutionToken: null,
      syncActivityAttemptToken: null,
    });
    expect(refreshInstallationRepositoriesMock).toHaveBeenCalledWith(expect.any(Object), 42, {});
  });

  it('requires workflow and activity attempt tokens together', async () => {
    const { syncRepositories } = createInstallationSyncWorkflow(createGithubContext());

    await expect(
      syncRepositories(
        { installationId: 42 },
        activityContext({ workflowExecutionToken: 'workflow-token' }),
      ),
    ).rejects.toThrow('Installation sync requires workflow and activity attempt tokens together');
  });

  it('marks the installation failed when repository refresh fails', async () => {
    const database = createDatabaseRecorder();
    refreshInstallationRepositoriesMock.mockRejectedValue(new Error('refresh failed'));
    const { syncRepositories } = createInstallationSyncWorkflow(createGithubContext(database));

    await expect(syncRepositories({ installationId: 42 }, activityContext())).rejects.toThrow(
      'refresh failed',
    );

    expect(database.updates[1]?.set).toMatchObject({
      syncStatus: 'failed',
      syncStartedAt: null,
      syncWorkflowExecutionToken: null,
      syncActivityAttemptToken: null,
    });
  });

  it('reconciles in-progress status on teardown with workflow token fencing', async () => {
    const database = createDatabaseRecorder();
    const { reconcileSyncStatusOnTeardown } = createInstallationSyncWorkflow(
      createGithubContext(database),
    );

    await reconcileSyncStatusOnTeardown(
      { installationId: 42, workflowStartedAt: Date.parse('2026-07-26T12:00:00.000Z') },
      activityContext({ workflowExecutionToken: 'workflow-token' }),
    );

    expect(database.updates[0]?.set).toMatchObject({
      syncStatus: 'failed',
      syncStartedAt: null,
    });
  });

  it('reconciles in-progress status on teardown without workflow token fencing', async () => {
    const database = createDatabaseRecorder();
    const { reconcileSyncStatusOnTeardown } = createInstallationSyncWorkflow(
      createGithubContext(database),
    );

    await reconcileSyncStatusOnTeardown({ installationId: 42 }, activityContext());

    expect(database.updates[0]?.set).toMatchObject({
      syncStatus: 'failed',
      syncStartedAt: null,
    });
  });
});

function createTestEngine(workflowDefinition: unknown): TestEngineInstance {
  const testEngine = new TestEngine();
  testEngine.registerWorkflows({ 'installation-sync': workflowDefinition });
  engine = testEngine;
  return testEngine;
}

function createGithubContext(database = createDatabaseRecorder()): GithubServiceContext {
  return {
    db: database.db as GithubServiceContext['db'],
    cache: {} as GithubServiceContext['cache'],
    getInstallationOctokit: vi.fn(),
  };
}

function activityContext(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    signal: new AbortController().signal,
    heartbeat: vi.fn(),
    completeAsync: () => {
      throw new Error('completeAsync is not used in these tests.');
    },
    ...overrides,
  };
}

function createDatabaseRecorder() {
  const updates: Array<{ set: unknown; whereArgs: unknown[] }> = [];
  type Chainable = {
    update: (...args: unknown[]) => Chainable;
    set: (payload: unknown) => Chainable;
    where: (...args: unknown[]) => Promise<void>;
    pendingSet?: unknown;
  };
  const chainable: Chainable = {
    update: () => chainable,
    set: (payload) => {
      chainable.pendingSet = payload;
      return chainable;
    },
    where: (...whereArgs) => {
      updates.push({ set: chainable.pendingSet, whereArgs });
      chainable.pendingSet = undefined;
      return Promise.resolve();
    },
  };
  return { db: chainable, updates };
}
