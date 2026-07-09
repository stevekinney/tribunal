import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRepository, mockCanAccess, mockListWebhookEvents, mockGetFilterOptions } = vi.hoisted(
  () => ({
    mockRepository: { value: { id: 42, owner: 'acme', name: 'widgets' } as unknown | null },
    mockCanAccess: { value: true },
    mockListWebhookEvents: vi.fn(),
    mockGetFilterOptions: vi.fn(),
  }),
);

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
  error: (status: number, message: string) => {
    throw { status, message, type: 'error' };
  },
}));

vi.mock('@tribunal/github/repositories/service', () => ({
  getRepositoryById: vi.fn(() => Promise.resolve(mockRepository.value)),
}));

vi.mock('$lib/server/repositories', () => ({
  userCanAccessRepository: vi.fn(() => Promise.resolve(mockCanAccess.value)),
}));

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

vi.mock('$lib/server/webhook-events', async () => {
  const actual = await vi.importActual('$lib/server/webhook-events');
  return {
    ...actual,
    listWebhookEvents: mockListWebhookEvents,
    getWebhookEventFilterOptions: mockGetFilterOptions,
  };
});

import { load } from './+page.server';

describe('/repositories/[repositoryId]/webhooks server load', () => {
  beforeEach(() => {
    mockRepository.value = { id: 42, owner: 'acme', name: 'widgets' };
    mockCanAccess.value = true;
    mockListWebhookEvents.mockReset();
    mockListWebhookEvents.mockResolvedValue({ events: [], page: 1, perPage: 25, totalCount: 0 });
    mockGetFilterOptions.mockReset();
    mockGetFilterOptions.mockResolvedValue({ eventTypes: [], actions: [] });
  });

  function createEvent(search = '') {
    return {
      params: { repositoryId: '42' },
      url: new URL(`http://localhost/repositories/42/webhooks${search}`),
      locals: { user: { id: 1, username: 'test-user' } },
    } as Parameters<typeof load>[0];
  }

  it('redirects unauthenticated requests to login', async () => {
    const event = {
      params: { repositoryId: '42' },
      url: new URL('http://localhost/repositories/42/webhooks'),
      locals: {},
    } as Parameters<typeof load>[0];

    await expect(load(event)).rejects.toMatchObject({ status: 302, location: '/login' });
  });

  it('404s when the repository does not exist', async () => {
    mockRepository.value = null;

    await expect(load(createEvent())).rejects.toMatchObject({ status: 404 });
  });

  it('404s when the user cannot access the repository', async () => {
    mockCanAccess.value = false;

    await expect(load(createEvent())).rejects.toMatchObject({ status: 404 });
  });

  it('fixes the query to the route repository ID', async () => {
    await load(createEvent());

    expect(mockListWebhookEvents).toHaveBeenCalledWith([42], expect.any(Object), 42);
    expect(mockGetFilterOptions).toHaveBeenCalledWith([42], 42);
  });

  it('parses filters from the query string', async () => {
    await load(createEvent('?webhook_event_type=push&webhook_page=3'));

    expect(mockListWebhookEvents).toHaveBeenCalledWith(
      [42],
      expect.objectContaining({ eventType: 'push', page: 3 }),
      42,
    );
  });
});
