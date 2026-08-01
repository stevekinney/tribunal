/**
 * Pull request review comment webhook event handler.
 * Handles: pull_request_review_comment.created, edited, deleted.
 */

import type { PullRequestReviewCommentEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';

/**
 * Handle pull_request_review_comment webhook events.
 * Review-comment activity is cache/state-only today; it does not enqueue
 * durable review-engine work.
 */
export async function handlePullRequestReviewComment(
  payload: PullRequestReviewCommentEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { logger } = context;

  switch (action) {
    case 'created':
      if (payload.sender?.type === 'Bot') {
        logger.debug('Ignoring bot review comment created event');
      }
      return;
    case 'edited':
      if (payload.sender?.type === 'Bot') {
        logger.debug('Ignoring bot review comment edited event');
      }
      return;
    case 'deleted':
      return;
    default:
      logger.debug({ action }, 'Unhandled pull_request_review_comment action');
  }
}
