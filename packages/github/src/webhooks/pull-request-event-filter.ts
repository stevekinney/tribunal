/**
 * Pull request review-engine event detection for GitHub webhooks.
 *
 * Review-engine triggers defer delivery claiming so GitHub can retry on transient failures.
 * This filter determines whether an event should use deferred claiming.
 */

import type { WebhookPayload } from './types.js';

/**
 * Check if a webhook event is a pull request review-engine trigger that should defer delivery claiming.
 * These events defer claiming so GitHub can retry on transient failures.
 *
 * The review engine currently persists durable intents for pull request lifecycle
 * events. Check completion events share the same dispatch path and must also
 * defer claiming when they target one or more pull requests, so transient
 * dispatch failures are retried by GitHub instead of being silently accepted.
 */
export function isPullRequestWebhookEvent(
  eventType: string | null,
  action: string | null,
  data: WebhookPayload,
): boolean {
  // pull_request.opened / reopened / ready_for_review / synchronize enqueue review intents.
  if (
    eventType === 'pull_request' &&
    (action === 'opened' ||
      action === 'reopened' ||
      action === 'ready_for_review' ||
      action === 'synchronize')
  ) {
    return true;
  }

  // pull_request.closed -> triggers prClosed signal.
  if (eventType === 'pull_request' && action === 'closed') {
    return true;
  }

  if (eventType === 'check_run' && action === 'completed') {
    const checkRun = data.check_run as { pull_requests?: unknown[] } | undefined;
    const pullRequests = checkRun?.pull_requests;
    return Array.isArray(pullRequests) && pullRequests.length > 0;
  }

  if (eventType === 'check_suite' && action === 'completed') {
    const checkSuite = data.check_suite as { pull_requests?: unknown[] } | undefined;
    const pullRequests = checkSuite?.pull_requests;
    return Array.isArray(pullRequests) && pullRequests.length > 0;
  }

  return false;
}
