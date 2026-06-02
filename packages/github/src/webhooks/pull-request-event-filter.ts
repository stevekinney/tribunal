/**
 * Pull request orchestrator event detection for GitHub webhooks.
 *
 * The orchestrator defers delivery claiming so GitHub can retry on transient failures.
 * This filter determines whether an event should use deferred claiming.
 */

import {
  isPullRequestReviewCommentCreatedEvent,
  isPullRequestReviewCommentEditedEvent,
  isIssueCommentCreatedEvent,
  isIssueCommentEditedEvent,
} from './validate-github-webhook.js';
import type { WebhookPayload } from './types.js';

/**
 * Check if a webhook event is a pull request orchestrator trigger that should defer delivery claiming.
 * These events defer claiming so GitHub can retry on transient failures.
 *
 * The orchestrator listens to a broader set of events than the old remediation system:
 * all PR activity that might change action items.
 */
export function isPullRequestWebhookEvent(
  eventType: string | null,
  action: string | null,
  data: WebhookPayload,
): boolean {
  // pull_request.opened / pull_request.reopened
  if (eventType === 'pull_request' && (action === 'opened' || action === 'reopened')) {
    return true;
  }

  // pull_request.closed → triggers prClosed signal
  if (eventType === 'pull_request' && action === 'closed') {
    return true;
  }

  // pull_request_review.submitted (all states) / pull_request_review.dismissed
  if (eventType === 'pull_request_review' && (action === 'submitted' || action === 'dismissed')) {
    return true;
  }

  // pull_request_review_comment.created / .edited (non-bot only)
  if (isPullRequestReviewCommentCreatedEvent(data) || isPullRequestReviewCommentEditedEvent(data)) {
    if (data.sender.type !== 'Bot') {
      return true;
    }
  }

  // pull_request_review_comment.deleted (all — can't filter by sender)
  if (eventType === 'pull_request_review_comment' && action === 'deleted') {
    return true;
  }

  // pull_request_review_thread.resolved / .unresolved
  if (
    eventType === 'pull_request_review_thread' &&
    (action === 'resolved' || action === 'unresolved')
  ) {
    return true;
  }

  // issue_comment on PRs (non-bot only): created / edited
  if (isIssueCommentCreatedEvent(data) || isIssueCommentEditedEvent(data)) {
    if (data.issue.pull_request && data.sender.type !== 'Bot') {
      return true;
    }
  }

  // issue_comment.deleted on PRs
  if (eventType === 'issue_comment' && action === 'deleted') {
    const issue = data.issue as { pull_request?: unknown } | undefined;
    if (issue?.pull_request) {
      return true;
    }
  }

  // check_run.completed / check_suite.completed (all conclusions)
  if (eventType === 'check_run' && action === 'completed') {
    const checkRun = data.check_run as { pull_requests?: unknown[] } | undefined;
    if (checkRun?.pull_requests?.length) {
      return true;
    }
  }

  if (eventType === 'check_suite' && action === 'completed') {
    const checkSuite = data.check_suite as { pull_requests?: unknown[] } | undefined;
    if (checkSuite?.pull_requests?.length) {
      return true;
    }
  }

  return false;
}
