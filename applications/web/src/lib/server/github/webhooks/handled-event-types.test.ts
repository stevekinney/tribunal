import { describe, expect, it } from 'vitest';
import {
  HANDLED_GITHUB_WEBHOOK_EVENT_TYPES,
  MANUAL_FALLBACK_GITHUB_WEBHOOK_EVENT_TYPES,
  ROUTER_HANDLED_GITHUB_WEBHOOK_EVENT_TYPES,
} from './handled-event-types';

describe('HANDLED_GITHUB_WEBHOOK_EVENT_TYPES', () => {
  it('is the union of the router-handled and manual-fallback event types', () => {
    expect(HANDLED_GITHUB_WEBHOOK_EVENT_TYPES).toEqual([
      ...ROUTER_HANDLED_GITHUB_WEBHOOK_EVENT_TYPES,
      ...MANUAL_FALLBACK_GITHUB_WEBHOOK_EVENT_TYPES,
    ]);
  });

  it('contains no duplicates between the two dispatch paths', () => {
    const unique = new Set(HANDLED_GITHUB_WEBHOOK_EVENT_TYPES);
    expect(unique.size).toBe(HANDLED_GITHUB_WEBHOOK_EVENT_TYPES.length);
  });

  it('matches the documented handled event list in documentation/API.md', () => {
    // See "Handled event types include ..." under `POST /api/webhooks/github`
    // in documentation/API.md -- keep both in sync.
    expect([...HANDLED_GITHUB_WEBHOOK_EVENT_TYPES].sort()).toEqual(
      [
        'pull_request',
        'pull_request_review',
        'pull_request_review_comment',
        'check_run',
        'check_suite',
        'installation',
        'installation_repositories',
        'installation_target',
        'github_app_authorization',
        'push',
        'issue_comment',
        'pull_request_review_thread',
      ].sort(),
    );
  });
});
