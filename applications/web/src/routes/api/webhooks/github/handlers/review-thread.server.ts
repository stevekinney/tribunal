/**
 * Pull request review thread webhook event handler (durable review intent dispatch).
 * Handles: pull_request_review_thread.resolved, unresolved.
 * This event type has no github-webhook-schemas Zod schema,
 * so it's dispatched outside the router.
 */

import type { WebhookContext } from './types';
import type { WebhookPayload } from '$lib/server/github/webhooks';
import type { PullRequestEventType } from '@tribunal/github/pull-requests/state/workflow-signals';
import { githubContext } from '$lib/server/github-context';
import { signalPullRequestEvent } from '@tribunal/github/pull-requests/state/workflow-signals';
import {
  isPullRequestReviewThreadResolvedEvent,
  isPullRequestReviewThreadUnresolvedEvent,
  type PullRequestReviewThreadResolvedEvent,
  type PullRequestReviewThreadUnresolvedEvent,
} from '@tribunal/github/webhooks/validate-github-webhook';

export async function handleReviewThread(
  action: string | null,
  data: WebhookPayload,
  context: WebhookContext,
): Promise<void> {
  // Narrow the payload to a known review_thread event so pull_request/repository/
  // sender fields are validated by the library schema before they are read. The
  // narrowing must stay in scope, so branch to a single typed handler.
  if (isPullRequestReviewThreadResolvedEvent(data)) {
    await signalReviewThread(context, data, 'review_thread_resolved', action);
    return;
  }
  if (isPullRequestReviewThreadUnresolvedEvent(data)) {
    await signalReviewThread(context, data, 'review_thread_unresolved', action);
    return;
  }
}

/** Library-validated review_thread events handled by this dispatcher. */
type ReviewThreadEvent =
  | PullRequestReviewThreadResolvedEvent
  | PullRequestReviewThreadUnresolvedEvent;

async function signalReviewThread(
  context: WebhookContext,
  data: ReviewThreadEvent,
  eventType: PullRequestEventType,
  action: string | null,
): Promise<void> {
  const { installationId, repositoryId, logger } = context;

  if (!data.pull_request.number) return;

  const result = await signalPullRequestEvent(githubContext, {
    repositoryId,
    prNumber: data.pull_request.number,
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
      `Failed to signal review_thread ${action} for workflow ${result.workflowId}: ${result.error}`,
    );
  }

  if (!result.enqueued) {
    logger.debug(`Review thread ${action} did not map to a durable review intent`);
    return;
  }

  logger.info(`Review thread ${action} review intent enqueued`);
}
