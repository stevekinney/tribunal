import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetRegisteredWebhooks = vi.hoisted(() => vi.fn());

vi.mock('@tribunal/github/webhooks/registered-webhooks', () => ({
  getRegisteredWebhooks: mockGetRegisteredWebhooks,
  NON_CONFIGURABLE_GITHUB_WEBHOOK_EVENTS: [
    'github_app_authorization',
    'installation',
    'installation_repositories',
  ],
}));

vi.mock('$lib/server/github-context', () => ({ githubContext: {} }));

import {
  computeHandledWebhookEventDrift,
  warnOnHandledWebhookEventDriftAtStartup,
} from './subscription-drift';
import { HANDLED_GITHUB_WEBHOOK_EVENT_TYPES } from './handled-event-types';

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

describe('warnOnHandledWebhookEventDriftAtStartup', () => {
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
    });

    await warnOnHandledWebhookEventDriftAtStartup();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns with the missing event types when the subscription has drifted', async () => {
    mockGetRegisteredWebhooks.mockResolvedValue({
      registered: ['check_suite'],
      unregistered: [],
    });

    await warnOnHandledWebhookEventDriftAtStartup();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).toContain('push');
    expect(message).toContain('pull_request');
  });

  it('does not warn (and does not throw) when the subscription cannot be determined', async () => {
    mockGetRegisteredWebhooks.mockRejectedValue(new Error('GitHub App is not configured'));

    await expect(warnOnHandledWebhookEventDriftAtStartup()).resolves.toBeUndefined();

    // A separate "could not determine" warning is expected, but never a
    // false "drifted" warning built from an empty/unknown registered set.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).toContain('Could not determine');
  });
});
