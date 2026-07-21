import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../database';
import { createFactories, resetIdCounter, type AllFactories } from './index';

describe('createFactories', () => {
  let testDb: TestDatabase;
  let factories: AllFactories;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    factories = createFactories(testDb.db);
  });

  afterAll(async () => {
    await testDb.close();
  });

  afterEach(async () => {
    await testDb.reset();
    resetIdCounter();
  });

  it('wires up every entity factory against the same database', () => {
    expect(factories.user).toBeDefined();
    expect(factories.githubInstallation).toBeDefined();
    expect(factories.webhookDelivery).toBeDefined();
    expect(factories.repository).toBeDefined();
    expect(factories.workflowRun).toBeDefined();
    expect(factories.userApiKey).toBeDefined();
    expect(factories.oauthConnection).toBeDefined();
  });

  describe('user factory', () => {
    it('applies defaults derived from the generated id when no overrides are given', async () => {
      const user = await factories.user.create();

      expect(user.username).toMatch(/^testuser\d+$/);
      expect(user.name).toMatch(/^Test User \d+$/);
      expect(user.avatarUrl).toContain('avatars.githubusercontent.com');
      expect(user.neonAuthUserId).toBeNull();
      expect(user.email).toBeNull();
      expect(user.isPlatformAdministrator).toBe(false);
    });

    it('honors every provided override', async () => {
      const user = await factories.user.create({
        username: 'octocat',
        neonAuthUserId: 'neon-1',
        name: 'The Octocat',
        avatarUrl: 'https://example.com/avatar.png',
        email: 'octocat@example.com',
        isPlatformAdministrator: true,
      });

      expect(user).toMatchObject({
        username: 'octocat',
        neonAuthUserId: 'neon-1',
        name: 'The Octocat',
        avatarUrl: 'https://example.com/avatar.png',
        email: 'octocat@example.com',
        isPlatformAdministrator: true,
      });
    });

    it('creates multiple distinct users via createMany', async () => {
      const users = await factories.user.createMany(3);

      expect(users).toHaveLength(3);
      expect(new Set(users.map((user) => user.username)).size).toBe(3);
    });
  });

  describe('githubInstallation factory', () => {
    it('applies defaults when no overrides are given', async () => {
      const installation = await factories.githubInstallation.create();

      expect(installation.accountType).toBe('Organization');
      expect(installation.repositorySelection).toBe('all');
      expect(installation.status).toBe('active');
      expect(installation.userId).toBeNull();
    });

    it('binds an installation to an existing user via createForUser', async () => {
      const user = await factories.user.create();
      const installation = await factories.githubInstallation.createForUser(user.id, {
        accountLogin: 'octo-org',
      });

      expect(installation.userId).toBe(user.id);
      expect(installation.accountLogin).toBe('octo-org');
    });
  });

  describe('webhookDelivery factory', () => {
    it('applies defaults when no overrides are given', async () => {
      const delivery = await factories.webhookDelivery.create();

      expect(delivery.eventType).toBe('push');
      expect(delivery.installationId).toBeNull();
    });

    it('creates a delivery scoped to an event type and installation via createForEvent', async () => {
      const installation = await factories.githubInstallation.create();
      const delivery = await factories.webhookDelivery.createForEvent(
        'pull_request',
        installation.installationId,
      );

      expect(delivery.eventType).toBe('pull_request');
      expect(delivery.installationId).toBe(installation.installationId);
    });

    it('defaults installationId to null when createForEvent omits it', async () => {
      const delivery = await factories.webhookDelivery.createForEvent('issues');

      expect(delivery.installationId).toBeNull();
    });
  });

  describe('repository factory', () => {
    it('derives owner, name, and uri from the generated id when no overrides are given', async () => {
      const repository = await factories.repository.create();

      expect(repository.owner).toMatch(/^test-owner-\d+$/);
      expect(repository.name).toMatch(/^test-repo-\d+$/);
      expect(repository.uri).toBe(`https://github.com/${repository.owner}/${repository.name}.git`);
      expect(repository.defaultBranch).toBeNull();
      expect(repository.installationId).toBeNull();
    });

    it('honors every provided override', async () => {
      const repository = await factories.repository.create({
        id: 555,
        owner: 'tribunal',
        name: 'engine',
        uri: 'https://github.com/tribunal/engine.git',
        defaultBranch: 'main',
        commit: 'abc123',
      });

      expect(repository).toMatchObject({
        id: 555,
        owner: 'tribunal',
        name: 'engine',
        uri: 'https://github.com/tribunal/engine.git',
        defaultBranch: 'main',
        commit: 'abc123',
      });
    });
  });

  describe('workflowRun factory', () => {
    it('applies defaults scoped to a workspace when no overrides are given', async () => {
      const run = await factories.workflowRun.create({ workspaceId: 42 });

      expect(run.workspaceId).toBe(42);
      expect(run.taskType).toBe('remediation');
      expect(run.triggerSource).toBe('manual');
      expect(run.phase).toBe('pending');
      expect(run.repositoryId).toBeNull();
      expect(run.workflowId).toContain('workflow:42:test:');
    });

    it('creates a run scoped to a repository via createForRepository', async () => {
      const repository = await factories.repository.create();
      const run = await factories.workflowRun.createForRepository(7, repository.id, {
        phase: 'completed',
      });

      expect(run.workspaceId).toBe(7);
      expect(run.repositoryId).toBe(repository.id);
      expect(run.phase).toBe('completed');
    });
  });

  describe('userApiKey factory', () => {
    it('applies defaults tied to an existing user', async () => {
      const user = await factories.user.create();
      const apiKey = await factories.userApiKey.create({ userId: user.id });

      expect(apiKey.userId).toBe(user.id);
      expect(apiKey.keyPrefix).toMatch(/^uak_[0-9a-f]{12}$/);
      expect(apiKey.keyHash).toHaveLength(64);
      expect(apiKey.revokedAt).toBeNull();
    });

    it('marks the key revoked when revoked is true', async () => {
      const user = await factories.user.create();
      const apiKey = await factories.userApiKey.create({ userId: user.id, revoked: true });

      expect(apiKey.revokedAt).toBeInstanceOf(Date);
    });

    it('creates multiple keys for the same user via createMany', async () => {
      const user = await factories.user.create();
      const apiKeys = await factories.userApiKey.createMany(2, { userId: user.id });

      expect(apiKeys).toHaveLength(2);
      expect(new Set(apiKeys.map((key) => key.keyPrefix)).size).toBe(2);
    });
  });

  describe('oauthConnection factory', () => {
    it('applies defaults tied to an existing user', async () => {
      const user = await factories.user.create();
      const connection = await factories.oauthConnection.create({ userId: user.id });

      expect(connection.userId).toBe(user.id);
      expect(connection.provider).toBe('github');
      expect(connection.providerUserId).toMatch(/^provider-user-\d+$/);
      expect(connection.accessToken).toMatch(/^test-access-token-\d+$/);
      expect(connection.refreshToken).toBeNull();
      expect(connection.scope).toBe('read:user,repo');
    });

    it('honors every provided override', async () => {
      const user = await factories.user.create();
      const connection = await factories.oauthConnection.create({
        userId: user.id,
        providerUserId: 'gh-123',
        accessToken: 'token-abc',
        refreshToken: 'refresh-abc',
        scope: 'read:user',
      });

      expect(connection).toMatchObject({
        userId: user.id,
        providerUserId: 'gh-123',
        accessToken: 'token-abc',
        refreshToken: 'refresh-abc',
        scope: 'read:user',
      });
    });
  });
});
