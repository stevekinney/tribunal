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
 * Orchestrator-trigger actions throw on dispatch failure for 500 retry.
 * Claiming is performed at the +server.ts level for all orchestrator events.
 *
 * TODO(weft): Route review signals into a ../weft pull request orchestrator
 * workflow instead of the current workflow-signals stub.
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
  });

  if (!result.ok) {
    throw new Error(
      `Failed to signal PR review ${action} for workflow ${result.workflowId}: ${result.error}`,
    );
  }

  logger.info(`PR review ${action} workflow signaled`);
}
