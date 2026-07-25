import { describe, expect, it } from 'vitest';
import {
  HANDLED_GITHUB_WEBHOOK_EVENT_TYPES,
  MANUAL_FALLBACK_GITHUB_WEBHOOK_EVENT_TYPES,
  ROUTER_HANDLED_GITHUB_WEBHOOK_EVENT_TYPES,
  UNCONDITIONAL_SIDE_EFFECT_GITHUB_WEBHOOK_EVENT_TYPES,
} from './handled-event-types';

describe('HANDLED_GITHUB_WEBHOOK_EVENT_TYPES', () => {
  it('is the union of the router-handled, manual-fallback, and unconditional-side-effect event types', () => {
    expect(HANDLED_GITHUB_WEBHOOK_EVENT_TYPES).toEqual([
      ...ROUTER_HANDLED_GITHUB_WEBHOOK_EVENT_TYPES,
      ...MANUAL_FALLBACK_GITHUB_WEBHOOK_EVENT_TYPES,
      ...UNCONDITIONAL_SIDE_EFFECT_GITHUB_WEBHOOK_EVENT_TYPES,
    ]);
  });

  it('contains no duplicates across the three dispatch/side-effect paths', () => {
    const unique = new Set(HANDLED_GITHUB_WEBHOOK_EVENT_TYPES);
    expect(unique.size).toBe(HANDLED_GITHUB_WEBHOOK_EVENT_TYPES.length);
  });

  it('matches the documented "handled event types" list in documentation/API.md for the router + manual-fallback dispatch paths only', () => {
    // documentation/API.md's "Handled event types include ..." sentence
    // (under `POST /api/webhooks/github`) describes only the typed-router and
    // manual-fallback dispatch paths -- the event types with a dedicated
    // per-type handler. It's deliberately narrower than
    // HANDLED_GITHUB_WEBHOOK_EVENT_TYPES (the drift baseline), which also
    // includes event types whose only effect is an unconditional
    // post-processing step (repository metadata sync, cache invalidation,
    // audit storage). Keep this list in sync with API.md, not with the full
    // drift baseline.
    const dispatchHandledEventTypes = [
      ...ROUTER_HANDLED_GITHUB_WEBHOOK_EVENT_TYPES,
      ...MANUAL_FALLBACK_GITHUB_WEBHOOK_EVENT_TYPES,
    ];

    expect([...dispatchHandledEventTypes].sort()).toEqual(
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

  it('includes every event type with a documented unconditional side effect', () => {
    expect([...UNCONDITIONAL_SIDE_EFFECT_GITHUB_WEBHOOK_EVENT_TYPES].sort()).toEqual(
      ['repository', 'member', 'team', 'organization', 'membership', 'issues', 'status'].sort(),
    );
  });
});
