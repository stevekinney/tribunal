import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetRegisteredWebhooks = vi.hoisted(() => vi.fn());

vi.mock('@tribunal/github/webhooks/registered-webhooks', () => ({
  getGitHubAppConfiguration: mockGetRegisteredWebhooks,
  NON_CONFIGURABLE_GITHUB_WEBHOOK_EVENTS: [
    'github_app_authorization',
    'installation',
    'installation_repositories',
  ],
}));

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

import {
  computeHandledWebhookEventDrift,
  computeRequiredGitHubAppPermissionDrift,
  REQUIRED_GITHUB_APP_PERMISSIONS,
  warnOnGitHubAppConfigurationDriftAtStartup,
} from './subscription-drift';
import { HANDLED_GITHUB_WEBHOOK_EVENT_TYPES } from './handled-event-types';

const healthyPermissions = Object.fromEntries(
  REQUIRED_GITHUB_APP_PERMISSIONS.map(({ permission, level }) => [permission, level]),
);

describe('computeHandledWebhookEventDrift', () => {
  it('returns nothing when every handled event type is registered', () => {
    const drift = computeHandledWebhookEventDrift(
      ['pull_request', 'push'],
      ['pull_request', 'push'],
    );

    expect(drift).toEqual([]);
  });

  it('returns handled event types that are missing from the registered set, sorted', () => {
    const drift = computeHandledWebhookEventDrift(
      ['push'],
      ['pull_request', 'push', 'check_suite'],
    );

    expect(drift).toEqual(['check_suite', 'pull_request']);
  });

  it('never reports non-configurable events as drifted, even when absent from the registered set', () => {
    // GitHub does not include github_app_authorization/installation/
    // installation_repositories in the subscribed `events` list at all --
    // they're delivered unconditionally. Treating their absence as drift
    // would be a permanent false positive.
    const drift = computeHandledWebhookEventDrift(
      [],
      ['github_app_authorization', 'installation', 'installation_repositories'],
    );

    expect(drift).toEqual([]);
  });

  it('defaults to the full HANDLED_GITHUB_WEBHOOK_EVENT_TYPES baseline', () => {
    const drift = computeHandledWebhookEventDrift([]);

    for (const eventType of HANDLED_GITHUB_WEBHOOK_EVENT_TYPES) {
      if (
        eventType === 'github_app_authorization' ||
        eventType === 'installation' ||
        eventType === 'installation_repositories'
      ) {
        expect(drift).not.toContain(eventType);
      } else {
        expect(drift).toContain(eventType);
      }
    }
  });
});

describe('computeRequiredGitHubAppPermissionDrift', () => {
  it('returns nothing when every required permission is granted at the required level', () => {
    const drift = computeRequiredGitHubAppPermissionDrift(healthyPermissions);

    expect(drift).toEqual([]);
  });

  it('reports missing permissions deterministically', () => {
    const drift = computeRequiredGitHubAppPermissionDrift({
      checks: 'write',
      metadata: 'read',
    });

    expect(drift).toEqual(
      REQUIRED_GITHUB_APP_PERMISSIONS.filter(
        ({ permission }) => permission !== 'checks' && permission !== 'metadata',
      ).map(({ permission, level }) => ({ permission, level, configured: 'missing' })),
    );
  });

  it('treats write as satisfying read and reports insufficient levels deterministically', () => {
    const drift = computeRequiredGitHubAppPermissionDrift(
      {
        checks: 'read',
        contents: 'write',
        metadata: 'read',
      },
      [
        { permission: 'contents', level: 'read' },
        { permission: 'checks', level: 'write' },
        { permission: 'metadata', level: 'read' },
      ],
    );

    expect(drift).toEqual([{ permission: 'checks', level: 'write', configured: 'read' }]);
  });
});

describe('warnOnGitHubAppConfigurationDriftAtStartup', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGetRegisteredWebhooks.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not warn when the App is subscribed to every handled event type', async () => {
    mockGetRegisteredWebhooks.mockResolvedValue({
      registered: [...HANDLED_GITHUB_WEBHOOK_EVENT_TYPES],
      unregistered: [],
      permissions: healthyPermissions,
    });

    await warnOnGitHubAppConfigurationDriftAtStartup();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('bypasses the cache so a redeploy cannot keep logging drift an operator already fixed', async () => {
    mockGetRegisteredWebhooks.mockResolvedValue({
      registered: [...HANDLED_GITHUB_WEBHOOK_EVENT_TYPES],
      unregistered: [],
      permissions: healthyPermissions,
    });

    await warnOnGitHubAppConfigurationDriftAtStartup();

    expect(mockGetRegisteredWebhooks).toHaveBeenCalledWith(expect.anything(), { bypass: true });
  });

  it('warns with both missing event types and insufficient permissions when App configuration has drifted', async () => {
    mockGetRegisteredWebhooks.mockResolvedValue({
      registered: ['check_suite'],
      unregistered: [],
      permissions: { ...healthyPermissions, checks: undefined },
    });

    await warnOnGitHubAppConfigurationDriftAtStartup();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).toContain('Missing webhook event subscriptions');
    expect(message).toContain('push');
    expect(message).toContain('pull_request');
    expect(message).toContain('Insufficient requested App permissions');
    expect(message).toContain('checks (missing < read)');
  });

  it('still checks and reports permission drift when event subscriptions are healthy', async () => {
    mockGetRegisteredWebhooks.mockResolvedValue({
      registered: [...HANDLED_GITHUB_WEBHOOK_EVENT_TYPES],
      unregistered: [],
      permissions: { ...healthyPermissions, issues: undefined },
    });

    await warnOnGitHubAppConfigurationDriftAtStartup();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).toContain('Missing webhook event subscriptions: none');
    expect(message).toContain('issues (missing < read)');
  });

  it('does not warn with a false drift report when App configuration cannot be determined', async () => {
    mockGetRegisteredWebhooks.mockRejectedValue(new Error('GitHub App is not configured'));

    await expect(warnOnGitHubAppConfigurationDriftAtStartup()).resolves.toBeUndefined();

    // A separate "could not determine" warning is expected, but never a
    // false "drifted" warning built from an empty/unknown registered set.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).toContain('Could not determine');
    expect(message).not.toContain('configuration drift detected');
  });
});
