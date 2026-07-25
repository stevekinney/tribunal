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

vi.mock('@tribunal/github/webhooks/registered-webhooks', async () => {
  const actual = await vi.importActual('@tribunal/github/webhooks/registered-webhooks');
  return {
    ...actual,
    getRegisteredWebhooks: mockGetRegisteredWebhooks,
  };
});

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

import { load } from './+page.server';

type WebhooksLoadResult = {
  hasRepositories: boolean;
  subscribedEventTypes: string[];
  driftedEventTypes: string[];
  subscriptionStatusKnown: boolean;
  loadError: string | null;
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
    mockGetFilterOptions.mockResolvedValue({ eventTypes: [], actions: [], receivedEventTypes: [] });
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

    expect(mockListWebhookEvents).toHaveBeenCalledWith([1], 1, expect.any(Object));
  });

  it('reflects no repositories when the user has none', async () => {
    mockRepositoriesResult.value = { ok: true, repositories: [], installations: [] };

    const result = (await load(createEvent())) as WebhooksLoadResult;

    expect(result.hasRepositories).toBe(false);
    expect(mockListWebhookEvents).toHaveBeenCalledWith([], 1, expect.any(Object));
  });

  it('still computes subscription drift when the user has no repositories -- drift is a GitHub App property, not a per-user one', async () => {
    mockRepositoriesResult.value = { ok: true, repositories: [], installations: [] };
    mockGetRegisteredWebhooks.mockResolvedValue({ registered: ['check_suite'], unregistered: [] });

    const result = (await load(createEvent())) as WebhooksLoadResult;

    expect(result.hasRepositories).toBe(false);
    expect(result.subscriptionStatusKnown).toBe(true);
    expect(result.driftedEventTypes).toContain('push');
  });

  it('surfaces subscribed App events without throwing when the App is unconfigured', async () => {
    mockGetRegisteredWebhooks.mockRejectedValue(new Error('GitHub App is not configured'));

    const result = (await load(createEvent())) as WebhooksLoadResult;

    expect(result.subscribedEventTypes).toEqual([]);
  });

  it('never reports drift when the subscription could not be determined', async () => {
    // A failed fetch must not be conflated with "the App is subscribed to
    // nothing" -- that would render every handled event type as a false
    // "drifted" warning on a transient GitHub outage.
    mockGetRegisteredWebhooks.mockRejectedValue(new Error('GitHub App is not configured'));

    const result = (await load(createEvent())) as WebhooksLoadResult;

    expect(result.driftedEventTypes).toEqual([]);
    expect(result.subscriptionStatusKnown).toBe(false);
  });

  it('includes subscribed events in the successful case', async () => {
    const result = (await load(createEvent())) as WebhooksLoadResult;

    expect(result.subscribedEventTypes).toEqual(['push']);
  });

  it('reports drift when the subscription is missing handled event types', async () => {
    mockGetRegisteredWebhooks.mockResolvedValue({ registered: ['check_suite'], unregistered: [] });

    const result = (await load(createEvent())) as WebhooksLoadResult;

    expect(result.subscriptionStatusKnown).toBe(true);
    expect(result.driftedEventTypes).toContain('push');
    expect(result.driftedEventTypes).toContain('pull_request');
    expect(result.driftedEventTypes).not.toContain('check_suite');
  });

  it('reports no drift once the App is subscribed to every handled event type', async () => {
    // Sourced from the real constant (not a hand-copied list) so this test
    // cannot silently pass against a stale baseline as the handled-event set
    // grows.
    const { HANDLED_GITHUB_WEBHOOK_EVENT_TYPES } =
      await import('$lib/server/github/webhooks/handled-event-types');
    mockGetRegisteredWebhooks.mockResolvedValue({
      registered: [...HANDLED_GITHUB_WEBHOOK_EVENT_TYPES],
      unregistered: [],
    });

    const result = (await load(createEvent())) as WebhooksLoadResult;

    expect(result.driftedEventTypes).toEqual([]);
  });

  it('bypasses the cache so the page cannot report stale subscription drift after an operator fixes it', async () => {
    await load(createEvent());

    expect(mockGetRegisteredWebhooks).toHaveBeenCalledWith(expect.anything(), { bypass: true });
  });

  it('parses filters from the query string', async () => {
    await load(createEvent('?webhook_event_type=pull_request&webhook_page=2'));

    expect(mockListWebhookEvents).toHaveBeenCalledWith(
      [1],
      1,
      expect.objectContaining({ eventType: 'pull_request', page: 2 }),
    );
  });

  it('redirects to the GitHub connect flow when the user has no GitHub token, instead of showing an empty repositories state', async () => {
    mockRepositoriesResult.value = {
      ok: false,
      error: 'no_github_token',
      message: 'No GitHub token.',
    };

    await expect(load(createEvent())).rejects.toMatchObject({
      status: 302,
      location: expect.stringContaining('/connect/github/account'),
    });
    expect(mockListWebhookEvents).not.toHaveBeenCalled();
  });

  it('sorts repositories by owner/name, including a tie', async () => {
    mockRepositoriesResult.value = {
      ok: true,
      repositories: [
        {
          repository: { id: 2, owner: 'zzz-org', name: 'zeta' },
          installation: { installationId: 2, accountLogin: 'zzz-org', accountAvatarUrl: null },
        },
        {
          repository: { id: 1, owner: 'aaa-org', name: 'alpha' },
          installation: { installationId: 1, accountLogin: 'aaa-org', accountAvatarUrl: null },
        },
        {
          repository: { id: 3, owner: 'aaa-org', name: 'alpha' },
          installation: { installationId: 1, accountLogin: 'aaa-org', accountAvatarUrl: null },
        },
      ],
      installations: [],
    };

    const result = (await load(createEvent())) as {
      repositories: Array<{ id: number; owner: string; name: string }>;
    };

    expect(result.repositories.map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it('surfaces a load error distinct from "no repositories" when GitHub is unreachable', async () => {
    mockRepositoriesResult.value = {
      ok: false,
      error: 'github_unavailable',
      message: 'Could not reach GitHub to list your installations. Please try again.',
    };

    const result = (await load(createEvent())) as WebhooksLoadResult;

    expect(result.hasRepositories).toBe(false);
    expect(result.loadError).toBe(
      'Could not reach GitHub to list your installations. Please try again.',
    );
    expect(mockListWebhookEvents).not.toHaveBeenCalled();
  });
});
