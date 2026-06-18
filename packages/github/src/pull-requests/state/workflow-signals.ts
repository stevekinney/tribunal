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
 * The consumer side — the `pull-request-orchestrator` workflow *definition* — is
 * ported and registered (applications/web/src/lib/server/weft/workflows/
 * pull-request-orchestrator.ts). The mapping these producers rely on:
 * - Coalescing: startOrSignal('pull-request-orchestrator', input,
 *   { name: 'pull_request_event', payload: { kind: 'event', ...input } }, { id }).
 *   The `kind` discriminant lets the orchestrator's ctx.race identify the winner.
 * - Close: signal(id, 'pull_request_closed', { kind: 'closed', merged }).
 * - Mid-flight supersede: ctx.race([ctx.run('analyzePullRequest'),
 *   ctx.waitForSignal('pull_request_event')]) (weft#456 — race accepts these).
 *
 * Notes on resolved upstream items:
 * - weft#448 (ctx.waitUntil) shipped, but the orchestrator's sliding debounce is
 *   correctly a ctx.race([sleep, waitForSignal]) loop, NOT waitUntil: signals are
 *   pull-only and do not re-drive a waitUntil predicate, so the race is the right
 *   idiom here.
 * - weft#453/#584: 0.5.0 cooperatively aborts a losing ctx.run race branch (the
 *   fast path), but the analyze activity STILL relies on a head-SHA generation
 *   fence + ctx.signal throwIfAborted as the load-bearing guard, because the abort
 *   is best-effort and a same-commit supersede does not move the head SHA.
 */

import { isWeftFault } from '@lostgradient/weft';
import type { GithubServiceContext, StartOrSignalOutcome } from '../../context.js';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * The stable Weft workflow id for a PR's orchestrator. Exported so lifecycle
 * teardown can cancel the running orchestrator by id (these runs live in Weft
 * storage under this deterministic id and are not enumerated via `workflow_run`).
 */
export function buildPullRequestOrchestratorWorkflowId(
  repositoryId: number,
  prNumber: number,
): string {
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
  return isWeftFault(error, 'WorkflowNotFoundError');
}

/**
 * True when dispatch failed only because no workflow of that name is registered
 * yet. A client may be configured (storage provisioned) before the workflow
 * definitions are ported; until then, dispatch is a no-op, not a failure —
 * otherwise enabling storage would 500 every webhook. Treated like "no client".
 *
 * `isWeftFault` (weft#465) matches both in-process `WeftError` subclasses and
 * HTTP-wrapped faults carrying a `weftCode`, so this branch holds unchanged if
 * the engine ever moves behind an `HttpClient`.
 */
function isWorkflowNotRegistered(error: unknown): boolean {
  return isWeftFault(error, 'WorkflowNotRegisteredError');
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
  /**
   * Which atomic path a `startOrSignal` dispatch took (weft#466): `'started'`
   * for a fresh orchestrator run, `'signalled'` for an event coalesced onto a
   * live run. Absent for signal-only paths (`signalPullRequestClosed`), no-op
   * fallbacks (no engine / unregistered workflow), and error results.
   */
  outcome?: StartOrSignalOutcome;
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

  try {
    // Resolve inside the try: a resolver failure (e.g. engine build / storage
    // outage) must return an error result, not throw past the webhook handler.
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

    const handle = await client.startOrSignal(
      'pull-request-orchestrator',
      input,
      {
        name: 'pull_request_event',
        // The orchestrator's ctx.race discriminates the winning branch by a
        // `kind` field on the payload (there is no keyed race), so the signal
        // payload must carry kind:'event'. The workflow *input* (2nd arg) stays
        // clean — only the signal payload is discriminated.
        payload: { kind: 'event', ...input },
        signalId: deriveSignalId(input.eventId),
      },
      { id: workflowId },
    );
    // weft#466: the handle reports which atomic path the call took — a fresh
    // orchestrator run ('started') vs. coalesced onto a live one ('signalled').
    return { ok: true, workflowId, outcome: handle.outcome };
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

  try {
    // Resolve inside the try: a resolver failure must return an error result,
    // not throw past the webhook handler.
    const client = await context.resolveWeftClient?.();
    if (!client) {
      console.log('[pull-request-orchestrator] would signal pull request closed (no engine)', {
        workflowId,
        merged: input.merged,
        actorLogin: input.actorLogin,
      });
      return { ok: true, workflowId };
    }

    await client.signal(workflowId, 'pull_request_closed', {
      // kind:'closed' lets the orchestrator's ctx.race discriminate this from a
      // pull_request_event payload and the sleep timer (see FIX 1 in the
      // orchestrator workflow). Without it the close is misrouted and the
      // workflow never reaches its final-analysis-and-exit path.
      kind: 'closed',
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
