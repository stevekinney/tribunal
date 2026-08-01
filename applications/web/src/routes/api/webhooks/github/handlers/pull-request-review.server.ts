/**
 * Pull request review webhook event handler.
 * Handles: pull_request_review.submitted, dismissed.
 */

import type { PullRequestReviewEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';

/**
 * Handle pull_request_review webhook events.
 * Review activity is cache/state-only today; it does not enqueue durable
 * review-engine work.
 */
export async function handlePullRequestReview(
  payload: PullRequestReviewEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { logger } = context;

  switch (action) {
    case 'submitted':
    case 'dismissed':
      return;
    default:
      logger.debug({ action }, 'Unhandled pull_request_review action');
  }
}
