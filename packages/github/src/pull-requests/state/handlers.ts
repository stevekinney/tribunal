import type { Octokit } from 'octokit';
import type { GithubServiceContext } from '../../context.js';
import { upsertPRState } from './state.js';
import {
  getFailingCheckCount,
  getUnresolvedReviewThreadCount,
  mapMergeableState,
} from './queries.js';

// ============================================================================
// PULL REQUEST EVENT HANDLER
// ============================================================================

interface PullRequestPayload {
  pull_request: {
    number: number;
    state: string;
    // GitHub sends `null` for not-yet-merged PRs; treated as not-merged below.
    merged: boolean | null;
    head: { sha: string };
    base: { ref: string };
    updated_at: string;
    merge_commit_sha?: string | null;
    mergeable_state?: string;
  };
  repository: { id: number; owner: { login: string }; name: string };
}

export const PR_ACTIONS = new Set([
  'opened',
  'closed',
  'reopened',
  'synchronize',
  'converted_to_draft',
  'ready_for_review',
]);

/**
 * Handle pull_request webhook events.
 * Extracts state directly from the payload (no API calls).
 */
export async function handlePullRequestStateUpdate(
  context: GithubServiceContext,
  payload: PullRequestPayload,
  action: string,
): Promise<void> {
  if (!PR_ACTIONS.has(action)) return;

  const { pull_request: pr, repository } = payload;

  const isMerged = pr.state === 'closed' && pr.merged === true;

  // Derive merge status from payload hints when available
  const mergeStatus = mapMergeableState(pr.mergeable_state);

  await upsertPRState(context, {
    repositoryId: repository.id,
    prNumber: pr.number,
    state: pr.state,
    isMerged,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    mergeStatus,
    mergeUpdatedAt: new Date(pr.updated_at),
    prUpdatedAt: new Date(pr.updated_at),
  });
}

// ============================================================================
// REVIEW EVENT HANDLER
// ============================================================================

interface ReviewPayload {
  // GitHub sends `null` for reviews without a submission timestamp (e.g. pending).
  review: { submitted_at?: string | null };
  pull_request: {
    number: number;
    head: { sha: string };
  };
  repository: { id: number; owner: { login: string }; name: string };
}

/**
 * Handle pull_request_review webhook events (submitted/dismissed).
 * Reads unresolved review thread count for dashboard freshness.
 */
export async function handleReviewStateUpdate(
  context: GithubServiceContext,
  payload: ReviewPayload,
  octokit: Octokit,
): Promise<void> {
  const { pull_request: pr, repository } = payload;

  const unresolvedThreadCount = await getUnresolvedReviewThreadCount(
    context,
    octokit,
    repository.owner.login,
    repository.name,
    pr.number,
  );

  const reviewUpdatedAt = payload.review.submitted_at
    ? new Date(payload.review.submitted_at)
    : new Date();

  await upsertPRState(context, {
    repositoryId: repository.id,
    prNumber: pr.number,
    unresolvedThreadCount,
    reviewUpdatedAt,
  });
}

// ============================================================================
// CHECK SUITE EVENT HANDLER
// ============================================================================

interface CheckSuitePayload {
  check_suite: {
    head_sha: string;
    updated_at?: string;
    pull_requests: Array<{ number: number }>;
  };
  repository: { id: number; owner: { login: string }; name: string };
}

/**
 * Handle check_suite.completed webhook events.
 * Makes one API call to count failing check runs.
 */
export async function handleCheckSuiteCompleted(
  context: GithubServiceContext,
  payload: CheckSuitePayload,
  octokit: Octokit,
): Promise<void> {
  const { check_suite, repository } = payload;

  // A check suite can be associated with multiple PRs
  if (check_suite.pull_requests.length === 0) return;

  const { ciStatus } = await getFailingCheckCount(
    context,
    octokit,
    repository.owner.login,
    repository.name,
    check_suite.head_sha,
  );

  const ciUpdatedAt = check_suite.updated_at ? new Date(check_suite.updated_at) : new Date();

  await Promise.all(
    check_suite.pull_requests.map((pr) =>
      upsertPRState(context, {
        repositoryId: repository.id,
        prNumber: pr.number,
        ciStatus,
        ciUpdatedAt,
        headSha: check_suite.head_sha,
      }),
    ),
  );
}
