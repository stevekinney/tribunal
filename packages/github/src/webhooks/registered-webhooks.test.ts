import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValidationError } from '../error-taxonomy.js';
import type { App } from 'octokit';
import type { GithubServiceContext } from '../context.js';
import type { CachedReadFetchFunction } from '../core/github-read-client.js';
import type { RegisteredWebhooks } from './registered-webhooks.js';

// ============================================================================
// Mocks
// ============================================================================

/**
 * Mock `cachedRead` to capture the fetch function passed to it.
 * This lets us test the fetch logic in isolation without needing Redis.
 */
let capturedFetchFunction: CachedReadFetchFunction<RegisteredWebhooks> | undefined;

vi.mock('../core/github-read-client.js', () => ({
  cachedRead: vi.fn(async (_cache, _policy, fetchFn) => {
    capturedFetchFunction = fetchFn;
    const result = await fetchFn();
    if (result.notModified) {
      return { value: undefined, source: 'conditional' };
    }
    return { value: result.data, source: 'api' };
  }),
}));

vi.mock('../core/cache-policy.js', () => ({
  requirePolicy: vi.fn().mockReturnValue({
    operationId: 'get-app-webhook-configuration',
    keyFactory: () => 'github:app:webhook-configuration',
    ttlSeconds: 86400,
    supportsEtag: true,
  }),
}));

// Import after mocking
const {
  getRegisteredWebhooks,
  ALL_GITHUB_WEBHOOK_EVENTS,
  NON_CONFIGURABLE_GITHUB_WEBHOOK_EVENTS,
  CONFIGURABLE_GITHUB_WEBHOOK_EVENTS,
} = await import('./registered-webhooks.js');

// ============================================================================
// Test helpers
// ============================================================================

function createMockContext(overrides?: Partial<GithubServiceContext>): GithubServiceContext {
  return {
    db: {} as any,
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

function createMockApp(events: string[] = []) {
  return {
    octokit: {
      rest: {
        apps: {
          getAuthenticated: vi.fn().mockResolvedValue({
            data: { events },
            headers: { etag: '"abc123"' },
          }),
        },
      },
    },
  } as unknown as App;
}

// ============================================================================
// Tests — ALL_GITHUB_WEBHOOK_EVENTS constant
// ============================================================================

describe('ALL_GITHUB_WEBHOOK_EVENTS', () => {
  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(ALL_GITHUB_WEBHOOK_EVENTS)).toBe(true);
  });

  it('is sorted alphabetically', () => {
    const sorted = [...ALL_GITHUB_WEBHOOK_EVENTS].sort();
    expect([...ALL_GITHUB_WEBHOOK_EVENTS]).toEqual(sorted);
  });

  it('contains no duplicates', () => {
    const unique = new Set(ALL_GITHUB_WEBHOOK_EVENTS);
    expect(unique.size).toBe(ALL_GITHUB_WEBHOOK_EVENTS.length);
  });

  it('includes well-known event types', () => {
    const events = [...ALL_GITHUB_WEBHOOK_EVENTS];
    expect(events).toContain('push');
    expect(events).toContain('pull_request');
    expect(events).toContain('installation');
    expect(events).toContain('issues');
    expect(events).toContain('check_run');
  });
});

describe('CONFIGURABLE_GITHUB_WEBHOOK_EVENTS', () => {
  it('omits default non-configurable events', () => {
    expect(CONFIGURABLE_GITHUB_WEBHOOK_EVENTS).not.toContain('github_app_authorization');
    expect(CONFIGURABLE_GITHUB_WEBHOOK_EVENTS).not.toContain('installation');
    expect(CONFIGURABLE_GITHUB_WEBHOOK_EVENTS).not.toContain('installation_repositories');
  });

  it('contains all non-configurable events in dedicated constant', () => {
    expect(NON_CONFIGURABLE_GITHUB_WEBHOOK_EVENTS).toEqual([
      'github_app_authorization',
      'installation',
      'installation_repositories',
    ]);
  });
});

// ============================================================================
// Tests — getRegisteredWebhooks
// ============================================================================

describe('getRegisteredWebhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedFetchFunction = undefined;
  });

  it('throws ValidationError when GitHub App is not configured', async () => {
    const context = createMockContext({
      getGithubApplication: vi.fn().mockReturnValue(null),
    });

    await expect(getRegisteredWebhooks(context)).rejects.toThrow(ValidationError);
  });

  it('returns registered and unregistered events', async () => {
    const registeredEvents = ['push', 'pull_request', 'issues'];
    const app = createMockApp(registeredEvents);
    const context = createMockContext({
      getGithubApplication: vi.fn().mockReturnValue(app),
    });

    const result = await getRegisteredWebhooks(context);

    expect(result.registered).toEqual(['issues', 'pull_request', 'push']);
    expect(result.unregistered).not.toContain('push');
    expect(result.unregistered).not.toContain('pull_request');
    expect(result.unregistered).not.toContain('issues');
    expect(result.unregistered.length).toBe(CONFIGURABLE_GITHUB_WEBHOOK_EVENTS.length - 3);
  });

  it('returns all events as unregistered when App has no subscriptions', async () => {
    const app = createMockApp([]);
    const context = createMockContext({
      getGithubApplication: vi.fn().mockReturnValue(app),
    });

    const result = await getRegisteredWebhooks(context);

    expect(result.registered).toEqual([]);
    expect(result.unregistered).toEqual([...CONFIGURABLE_GITHUB_WEBHOOK_EVENTS]);
  });

  it('sorts registered events alphabetically', async () => {
    const app = createMockApp(['push', 'create', 'fork', 'delete']);
    const context = createMockContext({
      getGithubApplication: vi.fn().mockReturnValue(app),
    });

    const result = await getRegisteredWebhooks(context);

    expect(result.registered).toEqual(['create', 'delete', 'fork', 'push']);
  });

  it('deduplicates registered events', async () => {
    const app = createMockApp(['push', 'push', 'issues']);
    const context = createMockContext({
      getGithubApplication: vi.fn().mockReturnValue(app),
    });

    const result = await getRegisteredWebhooks(context);

    expect(result.registered).toEqual(['issues', 'push']);
  });

  it('passes etag header for conditional requests', async () => {
    const mockGetAuthenticated = vi.fn().mockResolvedValue({
      data: { events: ['push'] },
      headers: { etag: '"new-etag"' },
    });
    const app = {
      octokit: {
        rest: { apps: { getAuthenticated: mockGetAuthenticated } },
      },
    } as unknown as App;
    const context = createMockContext({
      getGithubApplication: vi.fn().mockReturnValue(app),
    });

    await getRegisteredWebhooks(context);

    // Invoke the captured fetch function with an etag to verify header passing
    expect(capturedFetchFunction).toBeDefined();
    await capturedFetchFunction!('"some-etag"');

    expect(mockGetAuthenticated).toHaveBeenLastCalledWith({
      headers: { 'if-none-match': '"some-etag"' },
    });
  });

  it('returns notModified when API responds with 304', async () => {
    const notModifiedError = Object.assign(new Error('Not Modified'), { status: 304 });
    const mockGetAuthenticated = vi.fn().mockRejectedValue(notModifiedError);
    const app = {
      octokit: {
        rest: { apps: { getAuthenticated: mockGetAuthenticated } },
      },
    } as unknown as App;
    const context = createMockContext({
      getGithubApplication: vi.fn().mockReturnValue(app),
    });

    // First call to capture the fetch function
    // The mock cachedRead will call fetchFn() without etag, which will throw
    // because getAuthenticated rejects. So we need a two-call setup.
    mockGetAuthenticated
      .mockResolvedValueOnce({
        data: { events: ['push'] },
        headers: { etag: '"first"' },
      })
      .mockRejectedValueOnce(notModifiedError);

    await getRegisteredWebhooks(context);

    // Now invoke with etag to trigger 304 path
    const result = await capturedFetchFunction!('"first"');
    expect(result).toEqual({ notModified: true });
  });

  it('propagates API errors that are not 304', async () => {
    const apiError = Object.assign(new Error('Server Error'), { status: 500 });
    const mockGetAuthenticated = vi.fn().mockRejectedValue(apiError);
    const app = {
      octokit: {
        rest: { apps: { getAuthenticated: mockGetAuthenticated } },
      },
    } as unknown as App;
    const context = createMockContext({
      getGithubApplication: vi.fn().mockReturnValue(app),
    });

    await expect(getRegisteredWebhooks(context)).rejects.toThrow('Server Error');
  });

  it('handles null events array in API response', async () => {
    const app = {
      octokit: {
        rest: {
          apps: {
            getAuthenticated: vi.fn().mockResolvedValue({
              data: { events: null },
              headers: {},
            }),
          },
        },
      },
    } as unknown as App;
    const context = createMockContext({
      getGithubApplication: vi.fn().mockReturnValue(app),
    });

    const result = await getRegisteredWebhooks(context);

    expect(result.registered).toEqual([]);
    expect(result.unregistered).toEqual([...CONFIGURABLE_GITHUB_WEBHOOK_EVENTS]);
  });

  it('defers App resolution to the fetch callback (not eagerly)', async () => {
    const getGithubApplication = vi.fn().mockReturnValue(createMockApp(['push']));
    const context = createMockContext({ getGithubApplication });

    await getRegisteredWebhooks(context);

    // getGithubApplication is called inside the fetch callback, not before cachedRead
    // This ensures cache hits skip App resolution entirely.
    expect(getGithubApplication).toHaveBeenCalledTimes(1);
  });
});
