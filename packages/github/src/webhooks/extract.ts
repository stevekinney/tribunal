/**
 * Field extraction from GitHub webhook payloads.
 */

import {
  isPushEvent,
  isPullRequestOpenedEvent,
  isPullRequestClosedEvent,
  isIssueCommentCreatedEvent,
  isCheckRunCompletedEvent,
  isCheckSuiteCompletedEvent,
} from './validate-github-webhook.js';
import type { StoreWebhookEventData } from './webhook-events.js';
import type { WebhookPayload } from './types.js';

/**
 * Extract event-specific fields from a webhook payload for storage.
 * Uses shape-based extraction since the payload is already signature-verified.
 */
export function extractEventFields(
  eventType: string,
  data: WebhookPayload,
): Partial<StoreWebhookEventData> {
  const fields: Partial<StoreWebhookEventData> = {};

  switch (eventType) {
    case 'pull_request': {
      // opened/closed events carry a typed created_at; narrow with guards for those.
      if (isPullRequestOpenedEvent(data) || isPullRequestClosedEvent(data)) {
        fields.prNumber = data.pull_request.number;
        fields.githubCreatedAt = new Date(data.pull_request.created_at);
      } else {
        // Other pull_request actions (synchronize, reopened, etc.) have no matching
        // library guard; extract the PR number structurally.
        const pullRequest = data.pull_request as { number: number } | undefined;
        if (pullRequest) {
          fields.prNumber = pullRequest.number;
        }
      }
      break;
    }
    case 'pull_request_review': {
      const pullRequest = data.pull_request as { number: number } | undefined;
      if (pullRequest) {
        fields.prNumber = pullRequest.number;
      }
      break;
    }
    case 'pull_request_review_comment': {
      const pullRequest = data.pull_request as { number: number } | undefined;
      if (pullRequest) {
        fields.prNumber = pullRequest.number;
      }
      break;
    }
    case 'issues': {
      const issue = data.issue as { number: number; created_at?: string } | undefined;
      if (issue) {
        fields.issueNumber = issue.number;
        if (issue.created_at) {
          fields.githubCreatedAt = new Date(issue.created_at);
        }
      }
      break;
    }
    case 'issue_comment': {
      // created events expose a typed issue.number; narrow with the guard for that.
      if (isIssueCommentCreatedEvent(data)) {
        fields.issueNumber = data.issue.number;
      } else {
        // Other issue_comment actions (edited, deleted) have no matching extraction
        // guard listed here; extract the issue number structurally.
        const issue = data.issue as { number: number } | undefined;
        if (issue) {
          fields.issueNumber = issue.number;
        }
      }
      break;
    }
    case 'push': {
      if (isPushEvent(data)) {
        fields.ref = data.ref;
        if (data.head_commit) {
          fields.commitSha = data.head_commit.id;
        }
      }
      break;
    }
    case 'check_run': {
      if (isCheckRunCompletedEvent(data)) {
        fields.commitSha = data.check_run.head_sha;
      } else {
        const checkRun = data.check_run as { head_sha: string } | undefined;
        if (checkRun) {
          fields.commitSha = checkRun.head_sha;
        }
      }
      break;
    }
    case 'check_suite': {
      if (isCheckSuiteCompletedEvent(data)) {
        fields.commitSha = data.check_suite.head_sha;
      } else {
        const checkSuite = data.check_suite as { head_sha: string } | undefined;
        if (checkSuite) {
          fields.commitSha = checkSuite.head_sha;
        }
      }
      break;
    }
  }

  return fields;
}

/**
 * Extract repository owner and name from a webhook payload.
 */
export function getRepositoryIdentity(data: WebhookPayload): {
  owner: string | null;
  repo: string | null;
} {
  if (!('repository' in data) || !data.repository) {
    return { owner: null, repo: null };
  }

  const repository = data.repository as {
    name?: string;
    full_name?: string;
    owner?: { login?: string; name?: string };
  };

  const repo = repository.name ?? repository.full_name?.split('/')[1] ?? null;
  const owner =
    repository.owner?.login ??
    repository.owner?.name ??
    (repository.full_name ? repository.full_name.split('/')[0] : null) ??
    null;

  return { owner, repo };
}
