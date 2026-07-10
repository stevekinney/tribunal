import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, resetIdCounter } from '@tribunal/test/factories';
import { eq } from '../../operators';
import {
  agent,
  githubInstallationRepository,
  repository as repositoryTable,
  repositoryEventListener,
} from '../../schema';
import {
  createEventListener,
  deleteEventListener,
  getEventListener,
  listEnabledListenersForRepositoryEventType,
  listEventListenersForRepository,
  setEventListenerEnabled,
  updateEventListener,
} from '../event-listeners';

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

async function insertAgent(input: {
  id: string;
  userId: number;
  slug?: string;
  enabled?: boolean;
}) {
  const [row] = await testDatabase.db
    .insert(agent)
    .values({
      id: input.id,
      userId: input.userId,
      slug: input.slug ?? input.id,
      description: 'Test agent',
      body: 'Do the thing.',
      enabled: input.enabled ?? true,
    })
    .returning();
  return row;
}

/**
 * Link a user's active GitHub installation to a repository so
 * `listEnabledListenersForRepositoryEventType`'s active-ownership join
 * matches. Without this, a listener's owning user has no installation
 * access to the repository and the query correctly excludes it.
 */
async function grantActiveInstallationAccess(
  userId: number,
  repositoryId: number,
  options: { installationStatus?: 'active' | 'suspended'; linkActive?: boolean } = {},
) {
  const factories = createFactories(testDatabase.db);
  const installation = await factories.githubInstallation.createForUser(userId, {
    status: options.installationStatus ?? 'active',
  });
  await testDatabase.db.insert(githubInstallationRepository).values({
    installationId: installation.installationId,
    repositoryId,
    isActive: options.linkActive ?? true,
  });
  return installation;
}

async function createFixture() {
  const factories = createFactories(testDatabase.db);
  const user = await factories.user.create();
  const otherUser = await factories.user.create();
  const repository = await factories.repository.create({ id: 5001 });
  const otherRepository = await factories.repository.create({ id: 5002 });
  const testAgent = await insertAgent({ id: 'agent_1', userId: user.id });
  await grantActiveInstallationAccess(user.id, repository.id);
  await grantActiveInstallationAccess(user.id, otherRepository.id);
  return { user, otherUser, repository, otherRepository, testAgent };
}

describe('createEventListener', () => {
  it('creates a listener belonging to a user and repository', async () => {
    const { user, repository, testAgent } = await createFixture();

    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Label new issues',
      eventType: 'issues',
      action: 'opened',
      agentId: testAgent.id,
      instructionsMarkdown: '# Triage\nLook for duplicates.',
    });

    expect(listener.userId).toBe(user.id);
    expect(listener.repositoryId).toBe(repository.id);
    expect(listener.name).toBe('Label new issues');
    expect(listener.eventType).toBe('issues');
    expect(listener.action).toBe('opened');
    expect(listener.enabled).toBe(true);
    expect(listener.instructionsMarkdown).toContain('Look for duplicates');
    expect(listener.filtersJson).toBe('{}');
  });

  it('stores named filters', async () => {
    const { user, repository, testAgent } = await createFixture();

    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Watch main branch pushes',
      eventType: 'push',
      agentId: testAgent.id,
      filters: { ref: 'refs/heads/main' },
    });

    expect(JSON.parse(listener.filtersJson)).toEqual({ ref: 'refs/heads/main' });
  });

  it('rejects unsupported filter keys at creation time', async () => {
    const { user, repository, testAgent } = await createFixture();

    await expect(
      createEventListener(testDatabase.db, {
        userId: user.id,
        repositoryId: repository.id,
        name: 'Bad filter',
        eventType: 'push',
        agentId: testAgent.id,
        // @ts-expect-error -- deliberately invalid filter key for the test
        filters: { expression: 'payload.foo == "bar"' },
      }),
    ).rejects.toThrow();
  });

  it('rejects an agentId that belongs to a different user', async () => {
    const { user, otherUser, repository } = await createFixture();
    const otherUsersAgent = await insertAgent({ id: 'agent_other', userId: otherUser.id });

    await expect(
      createEventListener(testDatabase.db, {
        userId: user.id,
        repositoryId: repository.id,
        name: 'Cross-tenant agent',
        eventType: 'issues',
        agentId: otherUsersAgent.id,
      }),
    ).rejects.toThrow();
  });

  it('rejects a nonexistent agentId', async () => {
    const { user, repository } = await createFixture();

    await expect(
      createEventListener(testDatabase.db, {
        userId: user.id,
        repositoryId: repository.id,
        name: 'Missing agent',
        eventType: 'issues',
        agentId: 'agent_does_not_exist',
      }),
    ).rejects.toThrow();
  });
});

describe('updateEventListener / setEventListenerEnabled', () => {
  it('updates fields scoped to the owning user and repository', async () => {
    const { user, repository, testAgent } = await createFixture();
    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Original',
      eventType: 'issues',
      agentId: testAgent.id,
    });

    const updated = await updateEventListener(
      testDatabase.db,
      user.id,
      repository.id,
      listener.id,
      {
        name: 'Renamed',
        action: 'closed',
      },
    );

    expect(updated?.name).toBe('Renamed');
    expect(updated?.action).toBe('closed');
  });

  it('rejects re-pointing a listener at an agent owned by a different user', async () => {
    const { user, otherUser, repository, testAgent } = await createFixture();
    const otherUsersAgent = await insertAgent({ id: 'agent_other', userId: otherUser.id });
    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Original',
      eventType: 'issues',
      agentId: testAgent.id,
    });

    await expect(
      updateEventListener(testDatabase.db, user.id, repository.id, listener.id, {
        agentId: otherUsersAgent.id,
      }),
    ).rejects.toThrow();

    const unchanged = await getEventListener(testDatabase.db, user.id, repository.id, listener.id);
    expect(unchanged?.agentId).toBe(testAgent.id);
  });

  it('returns null when updating a listener owned by a different user', async () => {
    const { user, otherUser, repository, testAgent } = await createFixture();
    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Original',
      eventType: 'issues',
      agentId: testAgent.id,
    });

    const updated = await updateEventListener(
      testDatabase.db,
      otherUser.id,
      repository.id,
      listener.id,
      { name: 'Hijacked' },
    );

    expect(updated).toBeNull();
    const unchanged = await getEventListener(testDatabase.db, user.id, repository.id, listener.id);
    expect(unchanged?.name).toBe('Original');
  });

  it('enables and disables a listener', async () => {
    const { user, repository, testAgent } = await createFixture();
    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Toggle me',
      eventType: 'issues',
      agentId: testAgent.id,
    });

    const disabled = await setEventListenerEnabled(
      testDatabase.db,
      user.id,
      repository.id,
      listener.id,
      false,
    );
    expect(disabled?.enabled).toBe(false);

    const reEnabled = await setEventListenerEnabled(
      testDatabase.db,
      user.id,
      repository.id,
      listener.id,
      true,
    );
    expect(reEnabled?.enabled).toBe(true);
  });
});

describe('deleteEventListener', () => {
  it('deletes a listener scoped to its owner', async () => {
    const { user, repository, testAgent } = await createFixture();
    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Delete me',
      eventType: 'issues',
      agentId: testAgent.id,
    });

    const deleted = await deleteEventListener(testDatabase.db, user.id, repository.id, listener.id);
    expect(deleted).toBe(true);

    const found = await getEventListener(testDatabase.db, user.id, repository.id, listener.id);
    expect(found).toBeNull();
  });

  it('does not delete a listener owned by a different user', async () => {
    const { user, otherUser, repository, testAgent } = await createFixture();
    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Not yours',
      eventType: 'issues',
      agentId: testAgent.id,
    });

    const deleted = await deleteEventListener(
      testDatabase.db,
      otherUser.id,
      repository.id,
      listener.id,
    );
    expect(deleted).toBe(false);

    const found = await getEventListener(testDatabase.db, user.id, repository.id, listener.id);
    expect(found).not.toBeNull();
  });
});

describe('listEventListenersForRepository', () => {
  it('only returns listeners for the given user and repository', async () => {
    const { user, otherUser, repository, otherRepository, testAgent } = await createFixture();
    const otherAgent = await insertAgent({ id: 'agent_2', userId: otherUser.id });

    await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Mine, this repo',
      eventType: 'issues',
      agentId: testAgent.id,
    });
    await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: otherRepository.id,
      name: 'Mine, other repo',
      eventType: 'issues',
      agentId: testAgent.id,
    });
    await createEventListener(testDatabase.db, {
      userId: otherUser.id,
      repositoryId: repository.id,
      name: 'Not mine',
      eventType: 'issues',
      agentId: otherAgent.id,
    });

    const listeners = await listEventListenersForRepository(
      testDatabase.db,
      user.id,
      repository.id,
    );
    expect(listeners).toHaveLength(1);
    expect(listeners[0]?.name).toBe('Mine, this repo');
  });
});

describe('listEnabledListenersForRepositoryEventType', () => {
  it('matches only enabled listeners for the exact event type', async () => {
    const { user, repository, testAgent } = await createFixture();

    const matching = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Matches',
      eventType: 'issues',
      agentId: testAgent.id,
    });
    await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Wrong event type',
      eventType: 'push',
      agentId: testAgent.id,
    });
    const disabled = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Disabled',
      eventType: 'issues',
      agentId: testAgent.id,
      enabled: false,
    });

    const matched = await listEnabledListenersForRepositoryEventType(
      testDatabase.db,
      repository.id,
      'issues',
    );

    expect(matched.map((row) => row.id)).toEqual([matching.id]);
    expect(matched.map((row) => row.id)).not.toContain(disabled.id);
  });

  it('does not match a listener whose owner has no active installation access to the repository', async () => {
    const { user, repository, testAgent } = await createFixture();

    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Stale owner',
      eventType: 'issues',
      agentId: testAgent.id,
    });

    // Simulate the installation being removed (e.g. uninstalled, or the
    // repository transferred/reinstalled under a different account): the
    // repository row survives, but the user's installation link is gone.
    await testDatabase.db
      .delete(githubInstallationRepository)
      .where(eq(githubInstallationRepository.repositoryId, repository.id));

    const matched = await listEnabledListenersForRepositoryEventType(
      testDatabase.db,
      repository.id,
      'issues',
    );

    expect(matched.map((row) => row.id)).not.toContain(listener.id);
  });

  it('does not match a listener whose installation link is inactive', async () => {
    const { user, testAgent } = await createFixture();
    const factories = createFactories(testDatabase.db);
    const repository = await factories.repository.create({ id: 5003 });
    await grantActiveInstallationAccess(user.id, repository.id, { linkActive: false });

    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Removed from installation',
      eventType: 'issues',
      agentId: testAgent.id,
    });

    const matched = await listEnabledListenersForRepositoryEventType(
      testDatabase.db,
      repository.id,
      'issues',
    );

    expect(matched.map((row) => row.id)).not.toContain(listener.id);
  });

  it('does not match a listener whose installation is suspended', async () => {
    const { user, testAgent } = await createFixture();
    const factories = createFactories(testDatabase.db);
    const repository = await factories.repository.create({ id: 5004 });
    await grantActiveInstallationAccess(user.id, repository.id, {
      installationStatus: 'suspended',
    });

    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Suspended installation',
      eventType: 'issues',
      agentId: testAgent.id,
    });

    const matched = await listEnabledListenersForRepositoryEventType(
      testDatabase.db,
      repository.id,
      'issues',
    );

    expect(matched.map((row) => row.id)).not.toContain(listener.id);
  });
});

describe('repository/agent delete behavior', () => {
  it('cascades listener deletion when the repository is deleted', async () => {
    const { user, repository, testAgent } = await createFixture();
    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Cascades away',
      eventType: 'issues',
      agentId: testAgent.id,
    });

    await testDatabase.db.delete(repositoryTable).where(eq(repositoryTable.id, repository.id));

    const remaining = await testDatabase.db
      .select()
      .from(repositoryEventListener)
      .where(eq(repositoryEventListener.id, listener.id));
    expect(remaining).toHaveLength(0);
  });

  it('deleting an agent removes listeners referencing it -- no orphaned executable listener', async () => {
    const { user, repository, testAgent } = await createFixture();
    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Agent goes away',
      eventType: 'issues',
      agentId: testAgent.id,
    });

    await testDatabase.db.delete(agent).where(eq(agent.id, testAgent.id));

    const remaining = await testDatabase.db
      .select()
      .from(repositoryEventListener)
      .where(eq(repositoryEventListener.id, listener.id));
    expect(remaining).toHaveLength(0);
  });

  it('disabling an agent (not deleting it) leaves the listener row intact but non-dispatchable', async () => {
    const { user, repository, testAgent } = await createFixture();
    const listener = await createEventListener(testDatabase.db, {
      userId: user.id,
      repositoryId: repository.id,
      name: 'Agent disabled',
      eventType: 'issues',
      agentId: testAgent.id,
    });

    await testDatabase.db.update(agent).set({ enabled: false }).where(eq(agent.id, testAgent.id));

    const found = await getEventListener(testDatabase.db, user.id, repository.id, listener.id);
    expect(found).not.toBeNull();
    expect(found?.enabled).toBe(true);

    const [agentRow] = await testDatabase.db.select().from(agent).where(eq(agent.id, testAgent.id));
    expect(agentRow?.enabled).toBe(false);
  });
});
