/**
 * Issue comment webhook event handler.
 * Handles: issue_comment.created, edited, deleted on pull requests.
 * This event type has no github-webhook-schemas Zod schema,
 * so it's dispatched outside the router.
 */

import type { WebhookContext } from './types';
import type { WebhookPayload } from '$lib/server/github/webhooks';
import {
  isIssueCommentCreatedEvent,
  isIssueCommentEditedEvent,
  isIssueCommentDeletedEvent,
  type IssueCommentCreatedEvent,
  type IssueCommentEditedEvent,
  type IssueCommentDeletedEvent,
} from '@tribunal/github/webhooks/validate-github-webhook';

export async function handleIssueComment(
  action: string | null,
  data: WebhookPayload,
  context: WebhookContext,
): Promise<void> {
  if (isIssueCommentCreatedEvent(data)) {
    acceptIssueComment(data, action, context);
    return;
  }
  if (isIssueCommentEditedEvent(data)) {
    acceptIssueComment(data, action, context);
    return;
  }
  if (isIssueCommentDeletedEvent(data)) {
    acceptIssueComment(data, action, context);
  }
}

/** Library-validated issue_comment events handled by this dispatcher. */
type IssueCommentEvent =
  | IssueCommentCreatedEvent
  | IssueCommentEditedEvent
  | IssueCommentDeletedEvent;

function acceptIssueComment(
  data: IssueCommentEvent,
  action: string | null,
  context: WebhookContext,
): void {
  // Only pull request comments are in this handler's contract. Shared webhook
  // storage and cache invalidation handle the durable side effects.
  if (!data.issue.pull_request || !data.issue.number) return;

  if (data.sender.type === 'Bot' && (action === 'created' || action === 'edited')) {
    context.logger.debug(`Ignoring bot issue_comment ${action} event`);
  }
}
