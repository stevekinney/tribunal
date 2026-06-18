import { describe, expect, it } from 'vitest';
import { isPullRequestWebhookEvent } from './pull-request-event-filter.js';
import type { WebhookPayload } from './types.js';

describe('isPullRequestWebhookEvent', () => {
  it.each(['opened', 'reopened', 'ready_for_review', 'synchronize', 'closed'])(
    'defers claiming for pull_request.%s because it writes a review intent',
    (action) => {
      expect(isPullRequestWebhookEvent('pull_request', action, {} as WebhookPayload)).toBe(true);
    },
  );

  it('does not defer unrelated pull_request actions', () => {
    expect(isPullRequestWebhookEvent('pull_request', 'edited', {} as WebhookPayload)).toBe(false);
  });

  it.each([
    ['check_run', { check_run: { pull_requests: [{}] } }],
    ['check_suite', { check_suite: { pull_requests: [{}] } }],
  ] satisfies Array<[string, Record<string, unknown>]>)(
    'defers claiming for %s.completed when associated pull requests are present',
    (eventType, data) => {
      expect(isPullRequestWebhookEvent(eventType, 'completed', data as WebhookPayload)).toBe(true);
    },
  );

  it.each([
    ['pull_request_review', 'submitted', {}],
    ['pull_request_review', 'dismissed', {}],
    ['pull_request_review_comment', 'created', { sender: { type: 'User' } }],
    ['pull_request_review_comment', 'edited', { sender: { type: 'User' } }],
    ['pull_request_review_comment', 'deleted', {}],
    ['pull_request_review_thread', 'resolved', {}],
    ['pull_request_review_thread', 'unresolved', {}],
    ['issue_comment', 'created', { issue: { pull_request: {} }, sender: { type: 'User' } }],
    ['issue_comment', 'edited', { issue: { pull_request: {} }, sender: { type: 'User' } }],
    [
      'issue_comment',
      'deleted',
      { issue: { pull_request: { url: 'https://api.github.test/pulls/1' } } },
    ],
    ['check_run', 'completed', { check_run: { pull_requests: [] } }],
    ['check_suite', 'completed', { check_suite: { pull_requests: [] } }],
  ] satisfies Array<[string, string, Record<string, unknown>]>)(
    'does not defer claiming for %s.%s because no durable review intent is written',
    (eventType, action, data) => {
      expect(isPullRequestWebhookEvent(eventType, action, data as WebhookPayload)).toBe(false);
    },
  );

  it('does not defer unrelated events', () => {
    expect(isPullRequestWebhookEvent(null, null, {} as WebhookPayload)).toBe(false);
  });
});
