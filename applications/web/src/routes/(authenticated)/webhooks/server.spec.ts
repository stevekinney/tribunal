import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

const {
  mockRepositoriesResult,
  mockListWebhookEvents,
  mockGetFilterOptions,
  mockGetRegisteredWebhooks,
} = vi.hoisted(() => ({
  mockRepositoriesResult: {
    value: {
      ok: true,
      repositories: [
        {
          repository: { id: 1, owner: 'acme', name: 'widgets' },
          installation: { installationId: 1, accountLogin: 'acme', accountAvatarUrl: null },
        },
      ],
      installations: [],
    } as
      | {
          ok: true;
          repositories: Array<{
            repository: { id: number; owner: string; name: string };
            installation: unknown;
          }>;
          installations: unknown[];
        }
      | { ok: false; error: 'no_github_token' | 'github_unavailable'; message: string },
  },
  mockListWebhookEvents: vi.fn(),
  mockGetFilterOptions: vi.fn(),
  mockGetRegisteredWebhooks: vi.fn(),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$lib/server/repositories', () => ({
  getRepositoriesForUser: vi.fn(() => Promise.resolve(mockRepositoriesResult.value)),
}));

vi.mock('$lib/server/webhook-events', async () => {
  const actual = await vi.importActual('$lib/server/webhook-events');
  return {
    ...actual,
    listWebhookEvents: mockListWebhookEvents,
    getWebhookEventFilterOptions: mockGetFilterOptions,
  };
});

vi.mock('@tribunal/github/webhooks/registered-webhooks', () => ({
  getRegisteredWebhooks: mockGetRegisteredWebhooks,
}));

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

import { load } from './+page.server';

type WebhooksLoadResult = {
  hasRepositories: boolean;
  subscribedEventTypes: string[];
};

describe('/webhooks server load', () => {
  beforeEach(() => {
    mockRepositoriesResult.value = {
      ok: true,
      repositories: [
        {
          repository: { id: 1, owner: 'acme', name: 'widgets' },
          installation: { installationId: 1, accountLogin: 'acme', accountAvatarUrl: null },
        },
      ],
      installations: [],
    };
    mockListWebhookEvents.mockReset();
    mockListWebhookEvents.mockResolvedValue({ events: [], page: 1, perPage: 25, totalCount: 0 });
    mockGetFilterOptions.mockReset();
    mockGetFilterOptions.mockResolvedValue({ eventTypes: [], actions: [] });
    mockGetRegisteredWebhooks.mockReset();
    mockGetRegisteredWebhooks.mockResolvedValue({ registered: ['push'], unregistered: [] });
  });

  function createEvent(search = '') {
    return {
      url: new URL(`http://localhost/webhooks${search}`),
      locals: { user: { id: 1, username: 'test-user' } },
    } as Parameters<typeof load>[0];
  }

  it('redirects unauthenticated requests to login', async () => {
    const event = { url: new URL('http://localhost/webhooks'), locals: {} } as Parameters<
      typeof load
    >[0];

    await expect(load(event)).rejects.toMatchObject({ status: 302, location: '/login' });
  });

  it('scopes events to the user’s authorized repository IDs', async () => {
    await load(createEvent());

    expect(mockListWebhookEvents).toHaveBeenCalledWith([1], expect.any(Object));
  });

  it('reflects no repositories when the user has none', async () => {
    mockRepositoriesResult.value = { ok: true, repositories: [], installations: [] };

    const result = (await load(createEvent())) as WebhooksLoadResult;

    expect(result.hasRepositories).toBe(false);
    expect(mockListWebhookEvents).toHaveBeenCalledWith([], expect.any(Object));
  });

  it('surfaces subscribed App events without throwing when the App is unconfigured', async () => {
    mockGetRegisteredWebhooks.mockRejectedValue(new Error('GitHub App is not configured'));

    const result = (await load(createEvent())) as WebhooksLoadResult;

    expect(result.subscribedEventTypes).toEqual([]);
  });

  it('includes subscribed events in the successful case', async () => {
    const result = (await load(createEvent())) as WebhooksLoadResult;

    expect(result.subscribedEventTypes).toEqual(['push']);
  });

  it('parses filters from the query string', async () => {
    await load(createEvent('?webhook_event_type=pull_request&webhook_page=2'));

    expect(mockListWebhookEvents).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({ eventType: 'pull_request', page: 2 }),
    );
  });
});
