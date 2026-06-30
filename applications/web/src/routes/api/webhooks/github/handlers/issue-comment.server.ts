/**
 * Issue comment webhook event handler.
 * Handles: issue_comment.created, edited, deleted on PRs.
 * This event type has no github-webhook-schemas Zod schema,
 * so it's dispatched outside the router.
 */

import type { WebhookContext } from './types';
import type { WebhookPayload } from '$lib/server/github/webhooks';
import type { PullRequestEventType } from '@tribunal/github/pull-requests/state/workflow-signals';
import { githubContext } from '$lib/server/github-context';
import { signalPullRequestEvent } from '@tribunal/github/pull-requests/state/workflow-signals';
import {
  isIssueCommentCreatedEvent,
  isIssueCommentEditedEvent,
  isIssueCommentDeletedEvent,
  type IssueCommentCreatedEvent,
  type IssueCommentEditedEvent,
  type IssueCommentDeletedEvent,
} from '@tribunal/github/webhooks/validate-github-webhook';
import {
  hasDurableReviewIntentForDrain,
  kickReviewEngineAfterDurableIntent,
} from './review-engine-kick.server';

export async function handleIssueComment(
  action: string | null,
  data: WebhookPayload,
  context: WebhookContext,
): Promise<void> {
  // Narrow the payload to a known issue_comment event so issue/sender/repository
  // fields are validated by the library schema before they are read. The narrowed
  // type must stay in scope, so resolve the event type and keep the guard's
  // narrowing by branching to a single typed handler.
  if (isIssueCommentCreatedEvent(data)) {
    await signalIssueComment(context, data, 'issue_comment_created', action);
    return;
  }
  if (isIssueCommentEditedEvent(data)) {
    await signalIssueComment(context, data, 'issue_comment_edited', action);
    return;
  }
  if (isIssueCommentDeletedEvent(data)) {
    await signalIssueComment(context, data, 'issue_comment_deleted', action);
    return;
  }
}

/** Library-validated issue_comment events handled by this dispatcher. */
type IssueCommentEvent =
  | IssueCommentCreatedEvent
  | IssueCommentEditedEvent
  | IssueCommentDeletedEvent;

async function signalIssueComment(
  context: WebhookContext,
  data: IssueCommentEvent,
  eventType: PullRequestEventType,
  action: string | null,
): Promise<void> {
  const { installationId, repositoryId, logger } = context;

  // Only handle PR comments (issue_comment events fire for both issues and PRs)
  if (!data.issue.pull_request || !data.issue.number) return;

  // Filter bot senders for created/edited to avoid bot feedback loops
  if (data.sender.type === 'Bot' && (action === 'created' || action === 'edited')) return;

  const result = await signalPullRequestEvent(githubContext, {
    repositoryId,
    prNumber: data.issue.number,
    installationId,
    owner: data.repository.owner.login,
    repo: data.repository.name,
    eventType,
    actorLogin: data.sender.login,
    // GitHub delivery GUID -> Weft signalId for retry dedup.
    eventId: context.deliveryId,
  });

  if (!result.ok) {
    throw new Error(
      `Failed to signal issue_comment ${action} for workflow ${result.workflowId}: ${result.error}`,
    );
  }

  if (!hasDurableReviewIntentForDrain(result)) {
    logger.debug(`Issue comment ${action} did not map to a durable review intent`);
    return;
  }

  logger.info(`Issue comment ${action} review intent enqueued`);
  await kickReviewEngineAfterDurableIntent(result, logger);
}
