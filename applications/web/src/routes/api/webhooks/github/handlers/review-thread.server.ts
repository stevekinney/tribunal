/**
 * Pull request review thread webhook event handler.
 * Handles: pull_request_review_thread.resolved, unresolved.
 * This event type has no github-webhook-schemas Zod schema,
 * so it's dispatched outside the router.
 */

import type { WebhookContext } from './types';
import type { WebhookPayload } from '$lib/server/github/webhooks';
import {
  isPullRequestReviewThreadResolvedEvent,
  isPullRequestReviewThreadUnresolvedEvent,
} from '@tribunal/github/webhooks/validate-github-webhook';

export async function handleReviewThread(
  action: string | null,
  data: WebhookPayload,
  context: WebhookContext,
): Promise<void> {
  if (isPullRequestReviewThreadResolvedEvent(data)) {
    acceptReviewThread(data.pull_request.number, action, context);
    return;
  }
  if (isPullRequestReviewThreadUnresolvedEvent(data)) {
    acceptReviewThread(data.pull_request.number, action, context);
  }
}

function acceptReviewThread(
  prNumber: number | null | undefined,
  action: string | null,
  context: WebhookContext,
): void {
  // Shared webhook storage and cache invalidation handle the durable side
  // effects; review-thread events are not review-engine triggers today.
  if (!prNumber) return;

  context.logger.debug({ action, prNumber }, 'Accepted pull_request_review_thread event');
}
