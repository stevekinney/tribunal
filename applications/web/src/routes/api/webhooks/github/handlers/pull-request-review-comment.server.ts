/**
 * Pull request review comment webhook event handler.
 * Handles: pull_request_review_comment.created, edited, deleted
 */

import type { PullRequestReviewCommentEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';
import { githubContext } from '$lib/server/github-context';
import { signalPullRequestEvent } from '@tribunal/github/pull-requests/state/workflow-signals';
import type { PullRequestEventType } from '@tribunal/github/pull-requests/state/workflow-signals';

/**
 * Handle pull_request_review_comment webhook events.
 * Orchestrator-trigger actions throw on dispatch failure for 500 retry.
 * Claiming is performed at the +server.ts level for all orchestrator events.
 *
 * TODO(weft): Route review-comment signals into a ../weft pull request
 * orchestrator workflow instead of the current workflow-signals stub.
 */
export async function handlePullRequestReviewComment(
  payload: PullRequestReviewCommentEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { installationId, repositoryId, logger } = context;

  let eventType: PullRequestEventType | null = null;

  switch (action) {
    case 'created':
      // Filter bot-authored comment creations — bots creating review comments do not trigger orchestrator
      if (payload.sender?.type === 'Bot') {
        logger.debug('Ignoring bot review comment created event');
        return;
      }
      eventType = 'review_comment_created';
      break;
    case 'edited':
      // Filter bot-authored comment edits — bots editing review comments do not trigger orchestrator
      if (payload.sender?.type === 'Bot') {
        logger.debug('Ignoring bot review comment edited event');
        return;
      }
      eventType = 'review_comment_edited';
      break;
    case 'deleted':
      // Bot-authored deletions are allowed — deletion signals keep orchestrator state current
      eventType = 'review_comment_deleted';
      break;
    default:
      logger.debug({ action }, 'Unhandled pull_request_review_comment action');
      return;
  }

  // Orchestrator dispatch - must throw on failure for 500 response
  const result = await signalPullRequestEvent(githubContext, {
    workspaceId: 0,
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
      `Failed to signal PR review comment ${action} for workflow ${result.workflowId}: ${result.error}`,
    );
  }

  logger.info(`PR review comment ${action} workflow signaled`);
}
