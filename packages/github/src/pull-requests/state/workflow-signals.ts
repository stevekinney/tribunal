/**
 * Pull request orchestrator client entry point.
 *
 * Provides two functions for interacting with the pull request orchestrator:
 * - signalPullRequestEvent: Signal a pull request event
 * - signalPullRequestClosed: Signal PR closed
 *
 * The workflow dispatch that previously drove these has been removed. The
 * functions retain their signatures so existing callers keep compiling, and
 * log the signal that would have been sent.
 *
 * TODO(weft): Rebuild this as a ../weft pull request orchestrator workflow.
 * Depict's Temporal version used signalWithStart for webhook coalescing and
 * signal-only close events for already-running orchestrators.
 */

import type { GithubServiceContext } from '../../context.js';

// ============================================================================
// HELPERS
// ============================================================================

function buildPullRequestOrchestratorWorkflowId(repositoryId: number, prNumber: number): string {
  return `pull-request-orchestrator:${repositoryId}:${prNumber}`;
}

// ============================================================================
// TYPES
// ============================================================================

type PullRequestEventType =
  | 'pr_opened'
  | 'review_submitted'
  | 'review_dismissed'
  | 'review_comment_created'
  | 'review_comment_edited'
  | 'review_comment_deleted'
  | 'review_thread_resolved'
  | 'review_thread_unresolved'
  | 'issue_comment_created'
  | 'issue_comment_edited'
  | 'issue_comment_deleted'
  | 'check_completed'
  | 'base_branch_updated'
  | 'pr_closed'
  | 'manual';

export type { PullRequestEventType };

export interface SignalPullRequestEventInput {
  workspaceId: number;
  repositoryId: number;
  prNumber: number;
  installationId: number;
  owner: string;
  repo: string;
  eventType: PullRequestEventType;
  actorLogin?: string;
  eventId?: string;
}

export interface SignalPullRequestClosedInput {
  repositoryId: number;
  prNumber: number;
  merged: boolean;
  actorLogin?: string;
}

export interface SignalPullRequestResult {
  ok: boolean;
  workflowId: string;
  error?: string;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Signal a pull request event to the orchestrator.
 *
 * The workflow dispatch has been removed; this logs the signal that would
 * have been sent and reports success so callers keep their existing flow.
 */
export async function signalPullRequestEvent(
  _context: GithubServiceContext,
  input: SignalPullRequestEventInput,
): Promise<SignalPullRequestResult> {
  const workflowId = buildPullRequestOrchestratorWorkflowId(input.repositoryId, input.prNumber);

  console.log('[pull-request-orchestrator] would signal pull request event', {
    workflowId,
    eventType: input.eventType,
    workspaceId: input.workspaceId,
    repositoryId: input.repositoryId,
    pullRequestNumber: input.prNumber,
    actorLogin: input.actorLogin,
    eventId: input.eventId,
  });

  return { ok: true, workflowId };
}

/**
 * Signal that a PR was closed/merged.
 *
 * The workflow dispatch has been removed; this logs the signal that would
 * have been sent and reports success so callers keep their existing flow.
 */
export async function signalPullRequestClosed(
  _context: GithubServiceContext,
  input: SignalPullRequestClosedInput,
): Promise<SignalPullRequestResult> {
  const workflowId = buildPullRequestOrchestratorWorkflowId(input.repositoryId, input.prNumber);

  console.log('[pull-request-orchestrator] would signal pull request closed', {
    workflowId,
    merged: input.merged,
    actorLogin: input.actorLogin,
  });

  return { ok: true, workflowId };
}
