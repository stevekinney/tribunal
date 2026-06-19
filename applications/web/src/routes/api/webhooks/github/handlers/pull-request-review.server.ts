/**
 * Pull request review webhook event handler.
 * Handles: pull_request_review.submitted, dismissed
 */

import type { PullRequestReviewEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';
import { githubContext } from '$lib/server/github-context';
import { signalPullRequestEvent } from '@tribunal/github/pull-requests/state/workflow-signals';

/**
 * Handle pull_request_review webhook events.
 * Review activity is parsed here so the handler can become a durable trigger
 * when the review engine grows an explicit intent kind for review events.
 * Today only pull_request lifecycle events persist review_intent rows.
 */
export async function handlePullRequestReview(
  payload: PullRequestReviewEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { installationId, repositoryId, logger } = context;

  let eventType: 'review_submitted' | 'review_dismissed' | null = null;

  switch (action) {
    case 'submitted':
      eventType = 'review_submitted';
      break;
    case 'dismissed':
      eventType = 'review_dismissed';
      break;
    default:
      logger.debug({ action }, 'Unhandled pull_request_review action');
      return;
  }

  const result = await signalPullRequestEvent(githubContext, {
    repositoryId,
    prNumber: payload.pull_request.number,
    installationId,
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    eventType,
    actorLogin: payload.sender?.login,
    // GitHub delivery GUID -> Weft signalId for retry dedup.
    eventId: context.deliveryId,
  });

  if (!result.ok) {
    throw new Error(
      `Failed to signal PR review ${action} for workflow ${result.workflowId}: ${result.error}`,
    );
  }

  if (!result.enqueued) {
    logger.debug(`PR review ${action} did not map to a durable review intent`);
    return;
  }

  logger.info(`PR review ${action} review intent enqueued`);
}
