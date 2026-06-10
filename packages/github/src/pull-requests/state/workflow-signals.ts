/**
 * Pull request orchestrator client entry point.
 *
 * Provides two functions for interacting with the pull request orchestrator:
 * - signalPullRequestEvent: Signal a pull request event
 * - signalPullRequestClosed: Signal PR closed
 *
 * These dispatch through the in-process Weft client (on `GithubServiceContext`)
 * when one is configured, and fall back to log-only success when it is not — or
 * when the orchestrator workflow is not registered yet — so webhook acceptance
 * is never blocked on the engine.
 *
 * TODO(weft): Port the `pull-request-orchestrator` workflow *definition* (the
 * consumer side). Depict's Temporal version used signalWithStart for webhook
 * coalescing and signal-only close events for already-running orchestrators.
 *
 * Weft mapping for the orchestrator workflow:
 * - Coalescing: engine.startOrSignal('pull-request-orchestrator', input,
 *   { name: 'pull_request_event', payload }, { id: buildPullRequestOrchestratorWorkflowId(...) }).
 * - Close: engine.signal(id, 'pull_request_closed', { merged }).
 * - Mid-flight supersede: ctx.race([ctx.run('analyzePullRequest'), ctx.waitForSignal('pull_request_event')]).
 *
 * TODO(weft#448): The sliding-debounce loop currently must be hand-rolled as a
 * race-restart loop because Weft 0.3.0 has no ctx.condition/waitUntil predicate
 * gate. Replace the manual loop with the helper once it ships.
 * https://github.com/stevekinney/weft/issues/448
 * TODO(weft#453): analyzePullRequest activity must cooperatively honor
 * ctx.signal (throwIfAborted + pass signal to fetch) so a superseded analysis
 * actually stops; see the cooperative-cancellation contract.
 * https://github.com/stevekinney/weft/issues/453
 */

import { isWeftErrorLike } from '@lostgradient/weft';
import type { GithubServiceContext } from '../../context.js';

// ============================================================================
// HELPERS
// ============================================================================

function buildPullRequestOrchestratorWorkflowId(repositoryId: number, prNumber: number): string {
  return `pull-request-orchestrator:${repositoryId}:${prNumber}`;
}

/**
 * Identity for a single start-or-signal delivery.
 *
 * `startOrSignal` requires a `signalId` (paired with the workflow `id`) so
 * concurrent webhook deliveries converge on one run while each event is
 * delivered exactly once and deduplicated on retry. The natural token is the
 * GitHub delivery GUID (`eventId`); events without one (e.g. `manual` triggers)
 * mint a fresh id, since each is a distinct intent with no retry semantics.
 *
 * Note: this runs in dispatch code (not inside a workflow), so `crypto.randomUUID`
 * is fine — no checkpoint-determinism constraint applies.
 */
function deriveSignalId(eventId: string | undefined): string {
  return eventId ?? crypto.randomUUID();
}

/** True when an error means the target workflow does not exist. */
function isWorkflowNotFound(error: unknown): boolean {
  return isWeftErrorLike(error) && error.code === 'WorkflowNotFoundError';
}

/**
 * True when dispatch failed only because no workflow of that name is registered
 * yet. A client may be configured (storage provisioned) before the workflow
 * definitions are ported; until then, dispatch is a no-op, not a failure —
 * otherwise enabling storage would 500 every webhook. Treated like "no client".
 */
function isWorkflowNotRegistered(error: unknown): boolean {
  return isWeftErrorLike(error) && error.code === 'WorkflowNotRegisteredError';
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
 * When a Weft client is configured, this start-or-signals the per-PR
 * orchestrator (coalescing rapid webhook events onto one run). When no engine is
 * configured, it logs the signal that would have been sent and reports success
 * so callers keep their existing flow and webhook acceptance is never blocked.
 */
export async function signalPullRequestEvent(
  context: GithubServiceContext,
  input: SignalPullRequestEventInput,
): Promise<SignalPullRequestResult> {
  const workflowId = buildPullRequestOrchestratorWorkflowId(input.repositoryId, input.prNumber);

  const client = await context.resolveWeftClient?.();
  if (!client) {
    console.log('[pull-request-orchestrator] would signal pull request event (no engine)', {
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

  try {
    await client.startOrSignal(
      'pull-request-orchestrator',
      input,
      { name: 'pull_request_event', payload: input, signalId: deriveSignalId(input.eventId) },
      { id: workflowId },
    );
    return { ok: true, workflowId };
  } catch (error) {
    // Storage may be configured before the orchestrator workflow is ported.
    // Until it is, dispatch is a no-op success, not a webhook-failing error.
    if (isWorkflowNotRegistered(error)) {
      console.log(
        '[pull-request-orchestrator] orchestrator not registered yet; skipping dispatch',
        {
          workflowId,
          eventType: input.eventType,
        },
      );
      return { ok: true, workflowId };
    }
    return { ok: false, workflowId, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Signal that a PR was closed/merged.
 *
 * Signal-only: it targets an already-running orchestrator and does not start
 * one. When no engine is configured, it logs and reports success. A missing
 * target (no orchestrator running for this PR) is treated as success — there is
 * nothing to tell about a close.
 */
export async function signalPullRequestClosed(
  context: GithubServiceContext,
  input: SignalPullRequestClosedInput,
): Promise<SignalPullRequestResult> {
  const workflowId = buildPullRequestOrchestratorWorkflowId(input.repositoryId, input.prNumber);

  const client = await context.resolveWeftClient?.();
  if (!client) {
    console.log('[pull-request-orchestrator] would signal pull request closed (no engine)', {
      workflowId,
      merged: input.merged,
      actorLogin: input.actorLogin,
    });
    return { ok: true, workflowId };
  }

  try {
    await client.signal(workflowId, 'pull_request_closed', {
      merged: input.merged,
      actorLogin: input.actorLogin,
    });
    return { ok: true, workflowId };
  } catch (error) {
    // No running orchestrator to notify is not an error for a close event.
    if (isWorkflowNotFound(error)) {
      return { ok: true, workflowId };
    }
    return { ok: false, workflowId, error: error instanceof Error ? error.message : String(error) };
  }
}
