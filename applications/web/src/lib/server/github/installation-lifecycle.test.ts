import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import {
  createGitHubInstallationFactory,
  createRepositoryFactory,
  createUserFactory,
  createWorkflowRunFactory,
  resetIdCounter,
} from '@tribunal/test/factories';
import { githubInstallation, workflowRun } from '@tribunal/database/schema';
import type { GithubServiceContext } from '@tribunal/github/context';

import {
  handleInstallationDeleted,
  handleInstallationSuspend,
  handleInstallationUnsuspend,
  handleRepositoriesRemoved,
  cancelWorkflowsForRepositories,
} from '@tribunal/github/installations/lifecycle';

let testDb: TestDatabase;

function createMockContext(overrides?: Partial<GithubServiceContext>): GithubServiceContext {
  return {
    db: testDb.db as any,
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

describe('installation-lifecycle', () => {
  let context: GithubServiceContext;

  const setupFactories = () => ({
    user: createUserFactory(testDb.db),
    githubInstallation: createGitHubInstallationFactory(testDb.db),
    repository: createRepositoryFactory(testDb.db),
    workflowRun: createWorkflowRunFactory(testDb.db),
  });

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
    resetIdCounter();
    vi.clearAllMocks();
    context = createMockContext();
  });

  describe('handleInstallationSuspend', () => {
    it('updates installation status to suspended', async () => {
      const factories = setupFactories();
      const installation = await factories.githubInstallation.create({
        status: 'active',
      });

      await handleInstallationSuspend(context, installation.installationId, 'Test suspension');

      const [updated] = await testDb.db
        .select()
        .from(githubInstallation)
        .where(eq(githubInstallation.installationId, installation.installationId));

      expect(updated.status).toBe('suspended');
    });
  });

  describe('handleInstallationUnsuspend', () => {
    it('updates installation status to active', async () => {
      const factories = setupFactories();
      const installation = await factories.githubInstallation.create({
        status: 'suspended',
      });

      await handleInstallationUnsuspend(context, installation.installationId);

      const [updated] = await testDb.db
        .select()
        .from(githubInstallation)
        .where(eq(githubInstallation.installationId, installation.installationId));

      expect(updated.status).toBe('active');
    });
  });

  describe('handleInstallationDeleted', () => {
    it('cancels active workflows for all repositories in the installation', async () => {
      const factories = setupFactories();
      const installation = await factories.githubInstallation.create();
      const repository = await factories.repository.create({
        installationId: installation.installationId,
      });

      // Create an active workflow for the repository
      const workflow = await factories.workflowRun.create({
        workspaceId: 1,
        repositoryId: repository.id,
        phase: 'executing',
      });

      await handleInstallationDeleted(context, installation.installationId);

      // Check workflow was cancelled with installation_deleted reason
      const [updated] = await testDb.db
        .select()
        .from(workflowRun)
        .where(eq(workflowRun.id, workflow.id));

      expect(updated.phase).toBe('cancelled');
      expect(updated.cancellationReason).toBe('installation_deleted');
    });
  });

  describe('handleRepositoriesRemoved', () => {
    it('handles empty repository list gracefully', async () => {
      const factories = setupFactories();
      const installation = await factories.githubInstallation.create();

      // Should complete without throwing
      await expect(
        handleRepositoriesRemoved(context, installation.installationId, []),
      ).resolves.not.toThrow();
    });

    it('cancels active workflows for removed repositories', async () => {
      const factories = setupFactories();
      const installation = await factories.githubInstallation.create();
      const repository = await factories.repository.create({
        installationId: installation.installationId,
      });

      // Create an active workflow
      const workflow = await factories.workflowRun.create({
        workspaceId: 1,
        repositoryId: repository.id,
        phase: 'executing',
      });

      await handleRepositoriesRemoved(context, installation.installationId, [repository.id]);

      // Check workflow was cancelled
      const [updated] = await testDb.db
        .select()
        .from(workflowRun)
        .where(eq(workflowRun.id, workflow.id));

      expect(updated.phase).toBe('cancelled');
      expect(updated.cancellationReason).toBe('repository_removed');
    });
  });

  describe('cancelWorkflowsForRepositories', () => {
    it('returns zero counts for empty repository list', async () => {
      const result = await cancelWorkflowsForRepositories(context, [], 'test');

      expect(result.cancelled).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('cancels workflows in active phases only', async () => {
      const factories = setupFactories();
      const installation = await factories.githubInstallation.create();
      const repository = await factories.repository.create({
        installationId: installation.installationId,
      });

      // Create workflows in different phases
      const activeWorkflow = await factories.workflowRun.create({
        workspaceId: 1,
        repositoryId: repository.id,
        phase: 'executing',
      });
      const completedWorkflow = await factories.workflowRun.create({
        workspaceId: 1,
        repositoryId: repository.id,
        phase: 'completed',
      });

      const result = await cancelWorkflowsForRepositories(
        context,
        [repository.id],
        'test_cancellation',
      );

      // Only the active workflow should be cancelled
      expect(result.cancelled).toBe(1);

      // Check that the correct workflow was cancelled
      const [active] = await testDb.db
        .select()
        .from(workflowRun)
        .where(eq(workflowRun.id, activeWorkflow.id));

      const [completed] = await testDb.db
        .select()
        .from(workflowRun)
        .where(eq(workflowRun.id, completedWorkflow.id));

      expect(active.phase).toBe('cancelled');
      expect(active.cancellationReason).toBe('test_cancellation');
      expect(completed.phase).toBe('completed'); // unchanged
    });

    it('sets cancellation_reason on cancelled workflows', async () => {
      const factories = setupFactories();
      const installation = await factories.githubInstallation.create();
      const repository = await factories.repository.create({
        installationId: installation.installationId,
      });

      const workflow = await factories.workflowRun.create({
        workspaceId: 1,
        repositoryId: repository.id,
        phase: 'pending',
      });

      await cancelWorkflowsForRepositories(context, [repository.id], 'custom_reason');

      const [updated] = await testDb.db
        .select()
        .from(workflowRun)
        .where(eq(workflowRun.id, workflow.id));

      expect(updated.cancellationReason).toBe('custom_reason');
      expect(updated.completedAt).not.toBeNull();
    });
  });
});
