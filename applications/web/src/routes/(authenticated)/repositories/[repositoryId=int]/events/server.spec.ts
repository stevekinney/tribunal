import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, resetIdCounter } from '@tribunal/test/factories';
import { agent, repositoryEventListener } from '@tribunal/database/schema';
import { runWithDatabase } from '$lib/server/database';

const { mockRepository, mockCanAccess } = vi.hoisted(() => ({
  mockRepository: { value: { id: 42, owner: 'acme', name: 'widgets' } as unknown | null },
  mockCanAccess: { value: true },
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
  error: (status: number, message: string) => {
    throw { status, message, type: 'error' };
  },
  fail: (status: number, data: Record<string, unknown>) => ({ status, data }),
}));

vi.mock('@tribunal/github/repositories/service', () => ({
  getRepositoryById: vi.fn(() => Promise.resolve(mockRepository.value)),
}));

vi.mock('$lib/server/repositories', () => ({
  userCanAccessRepository: vi.fn(() => Promise.resolve(mockCanAccess.value)),
}));

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('@tribunal/github/webhooks/registered-webhooks', () => ({
  getRegisteredWebhooks: vi.fn(() => Promise.resolve({ registered: ['issues', 'pull_request'] })),
}));

import { actions, load } from './+page.server';
import type { PageData } from './$types';

describe('/repositories/[repositoryId]/events server load and actions', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
    resetIdCounter();
    mockRepository.value = { id: 42, owner: 'acme', name: 'widgets' };
    mockCanAccess.value = true;
  });

  function withTestDatabase<T>(operation: () => T): T {
    return runWithDatabase(testDb.db as never, operation);
  }

  /**
   * `PageServerLoad`'s declared return type widens to a generic
   * `OutputDataShape` that includes `void` when called outside SvelteKit's
   * own type-narrowing machinery (which normally resolves the concrete
   * shape through the generated `PageData` type). Assert the concrete shape
   * here rather than losing type safety on every call site below.
   */
  function loadPage(userId: number, search = ''): Promise<PageData> {
    return withTestDatabase(() => load(createLoadEvent(userId, search))) as Promise<PageData>;
  }

  async function createFixture() {
    const factories = createFactories(testDb.db);
    const user = await factories.user.create();
    const repository = await factories.repository.create({ id: 42 });
    const [testAgent] = await testDb.db
      .insert(agent)
      .values({
        id: 'agent_1',
        userId: user.id,
        slug: 'agent-1',
        description: 'Test agent',
        body: 'Do the thing.',
      })
      .returning();
    return { user, repository, testAgent };
  }

  function createLoadEvent(userId: number | undefined, search = '') {
    return {
      params: { repositoryId: '42' },
      url: new URL(`http://localhost/repositories/42/events${search}`),
      locals: userId ? { user: { id: userId, username: 'test-user' } } : {},
    } as Parameters<typeof load>[0];
  }

  function createActionEvent(userId: number | undefined, formData: Record<string, string>) {
    const body = new URLSearchParams(formData);
    return {
      params: { repositoryId: '42' },
      request: new Request('http://localhost/repositories/42/events', {
        method: 'POST',
        body,
      }),
      locals: userId ? { user: { id: userId, username: 'test-user' } } : {},
    } as unknown as Parameters<(typeof actions)['create']>[0];
  }

  describe('load', () => {
    it('redirects unauthenticated requests to login', async () => {
      await expect(withTestDatabase(() => load(createLoadEvent(undefined)))).rejects.toMatchObject({
        status: 302,
        location: '/login',
      });
    });

    it('404s when the repository does not exist', async () => {
      mockRepository.value = null;
      const { user } = await createFixture();

      await expect(withTestDatabase(() => load(createLoadEvent(user.id)))).rejects.toMatchObject({
        status: 404,
      });
    });

    it('404s when the user cannot access the repository', async () => {
      mockCanAccess.value = false;
      const { user } = await createFixture();

      await expect(withTestDatabase(() => load(createLoadEvent(user.id)))).rejects.toMatchObject({
        status: 404,
      });
    });

    it('shows an empty listener list', async () => {
      const { user } = await createFixture();

      const result = await loadPage(user.id);

      expect(result.listeners).toEqual([]);
    });

    it('lists listeners with agent and progress context', async () => {
      const { user, repository, testAgent } = await createFixture();
      await testDb.db.insert(repositoryEventListener).values({
        id: 'listener_1',
        userId: user.id,
        repositoryId: repository.id,
        name: 'Triage issues',
        eventType: 'issues',
        agentId: testAgent.id,
      });

      const result = await loadPage(user.id);

      expect(result.listeners).toHaveLength(1);
      expect(result.listeners[0]?.listener.name).toBe('Triage issues');
      expect(result.listeners[0]?.agentSlug).toBe('agent-1');
      expect(result.listeners[0]?.lastDelivery).toBeNull();
    });

    it('derives event type choices from subscribed and received events, not a guessed catalog', async () => {
      const { user } = await createFixture();

      const result = await loadPage(user.id);

      expect(result.eventTypeOptions).toEqual(expect.arrayContaining(['issues', 'pull_request']));
    });

    it('resolves the listener being edited from the ?listener= query param', async () => {
      const { user, repository, testAgent } = await createFixture();
      await testDb.db.insert(repositoryEventListener).values({
        id: 'listener_1',
        userId: user.id,
        repositoryId: repository.id,
        name: 'Triage issues',
        eventType: 'issues',
        agentId: testAgent.id,
        filtersJson: JSON.stringify({ ref: 'refs/heads/main' }),
      });

      const result = await loadPage(user.id, '?listener=listener_1');

      expect(result.editing).toBe('listener_1');
      expect(result.editingListener?.name).toBe('Triage issues');
      expect(result.editingListenerFilters).toEqual({ ref: 'refs/heads/main' });
    });

    it('treats ?listener=new as a create form, not an edit target', async () => {
      const { user } = await createFixture();

      const result = await loadPage(user.id, '?listener=new');

      expect(result.editing).toBe('new');
      expect(result.editingListener).toBeNull();
    });
  });

  describe('actions.create', () => {
    it('creates a listener with named filters and redirects back to the events page', async () => {
      const { user, testAgent } = await createFixture();

      await expect(
        withTestDatabase(() =>
          actions.create(
            createActionEvent(user.id, {
              name: 'Triage issues',
              eventType: 'issues',
              action: 'opened',
              agentId: testAgent.id,
              instructionsMarkdown: '# Triage',
              enabled: 'on',
              filterRef: 'refs/heads/main',
            }),
          ),
        ),
      ).rejects.toMatchObject({ status: 303, location: '/repositories/42/events' });

      const [row] = await testDb.db.select().from(repositoryEventListener);
      expect(row?.name).toBe('Triage issues');
      expect(row?.enabled).toBe(true);
      expect(JSON.parse(row?.filtersJson ?? '{}')).toEqual({ ref: 'refs/heads/main' });
    });

    it('rejects an invalid numeric filter', async () => {
      const { user, testAgent } = await createFixture();

      const result = await withTestDatabase(() =>
        actions.create(
          createActionEvent(user.id, {
            name: 'Bad filter',
            eventType: 'issues',
            agentId: testAgent.id,
            filterPrNumber: 'not-a-number',
          }),
        ),
      );

      expect(result).toMatchObject({ status: 400 });
      const rows = await testDb.db.select().from(repositoryEventListener);
      expect(rows).toHaveLength(0);
    });

    it('rejects a missing agent selection', async () => {
      const { user } = await createFixture();

      const result = await withTestDatabase(() =>
        actions.create(
          createActionEvent(user.id, {
            name: 'No agent',
            eventType: 'issues',
            agentId: '',
          }),
        ),
      );

      expect(result).toMatchObject({ status: 400 });
    });

    it('404s create attempts against an inaccessible repository', async () => {
      mockCanAccess.value = false;
      const { user, testAgent } = await createFixture();

      await expect(
        withTestDatabase(() =>
          actions.create(
            createActionEvent(user.id, {
              name: 'Triage issues',
              eventType: 'issues',
              agentId: testAgent.id,
            }),
          ),
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('actions.update', () => {
    it('updates a listener, preserving an action no longer in the observed set', async () => {
      const { user, repository, testAgent } = await createFixture();
      await testDb.db.insert(repositoryEventListener).values({
        id: 'listener_1',
        userId: user.id,
        repositoryId: repository.id,
        name: 'Original',
        eventType: 'issues',
        action: 'archaic_action',
        agentId: testAgent.id,
      });

      await expect(
        withTestDatabase(() =>
          actions.update(
            createActionEvent(user.id, {
              listenerId: 'listener_1',
              name: 'Renamed',
              eventType: 'issues',
              action: 'archaic_action',
              agentId: testAgent.id,
              enabled: 'on',
            }),
          ),
        ),
      ).rejects.toMatchObject({ status: 303, location: '/repositories/42/events' });

      const [row] = await testDb.db.select().from(repositoryEventListener);
      expect(row?.name).toBe('Renamed');
      expect(row?.action).toBe('archaic_action');
    });
  });

  describe('actions.setEnabled', () => {
    it('enables and disables a listener', async () => {
      const { user, repository, testAgent } = await createFixture();
      await testDb.db.insert(repositoryEventListener).values({
        id: 'listener_1',
        userId: user.id,
        repositoryId: repository.id,
        name: 'Toggle me',
        eventType: 'issues',
        agentId: testAgent.id,
      });

      await withTestDatabase(() =>
        actions.setEnabled(
          createActionEvent(user.id, { listenerId: 'listener_1', enabled: 'false' }),
        ),
      );
      let [row] = await testDb.db.select().from(repositoryEventListener);
      expect(row?.enabled).toBe(false);

      await withTestDatabase(() =>
        actions.setEnabled(
          createActionEvent(user.id, { listenerId: 'listener_1', enabled: 'true' }),
        ),
      );
      [row] = await testDb.db.select().from(repositoryEventListener);
      expect(row?.enabled).toBe(true);
    });
  });

  describe('actions.delete', () => {
    it('deletes a listener behind repository access', async () => {
      const { user, repository, testAgent } = await createFixture();
      await testDb.db.insert(repositoryEventListener).values({
        id: 'listener_1',
        userId: user.id,
        repositoryId: repository.id,
        name: 'Delete me',
        eventType: 'issues',
        agentId: testAgent.id,
      });

      const result = await withTestDatabase(() =>
        actions.delete(createActionEvent(user.id, { listenerId: 'listener_1' })),
      );

      expect(result).toEqual({ success: true });
      const rows = await testDb.db.select().from(repositoryEventListener);
      expect(rows).toHaveLength(0);
    });

    it('404s delete attempts against an inaccessible repository', async () => {
      mockCanAccess.value = false;
      const { user } = await createFixture();

      await expect(
        withTestDatabase(() =>
          actions.delete(createActionEvent(user.id, { listenerId: 'listener_1' })),
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
