import { reviewIntent, type ReviewIntent } from '@tribunal/database/schema';
import type { GithubServiceContext } from '../../context.js';
import { ValidationError } from '../../error-taxonomy.js';

type ReviewIntentKind = 'start' | 'commit_pushed' | 'pr_closed';
type PullRequestEventType =
  | 'pr_opened'
  | 'pr_reopened'
  | 'pr_ready_for_review'
  | 'pr_synchronized'
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

export type { PullRequestEventType, ReviewIntentKind };

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
  headSha?: string | null;
}

export interface SignalPullRequestClosedInput {
  repositoryId: number;
  prNumber: number;
  merged: boolean;
  actorLogin?: string;
  eventId?: string;
  headSha?: string | null;
}

export interface SignalPullRequestResult {
  ok: boolean;
  workflowId: string;
  intentId?: string;
  intentKind?: ReviewIntentKind;
  enqueued: boolean;
  error?: string;
}

export function buildPullRequestOrchestratorWorkflowId(
  repositoryId: number,
  prNumber: number,
): string {
  return `review:pr:${repositoryId}:${prNumber}`;
}

export function mapPullRequestEventToReviewIntentKind(
  eventType: PullRequestEventType,
): ReviewIntentKind | null {
  switch (eventType) {
    case 'pr_opened':
    case 'pr_reopened':
    case 'pr_ready_for_review':
      return 'start';
    case 'pr_synchronized':
    case 'check_completed':
      return 'commit_pushed';
    case 'pr_closed':
      return 'pr_closed';
    default:
      return null;
  }
}

function createReviewIntentId(): string {
  return `review_intent_${crypto.randomUUID()}`;
}

async function enqueueReviewIntent(
  context: GithubServiceContext,
  input: {
    deliveryId?: string;
    kind: ReviewIntentKind;
    repositoryId: number;
    prNumber: number;
    headSha?: string | null;
    prState?: 'merged' | 'closed' | null;
  },
): Promise<{ enqueued: boolean; intent?: ReviewIntent }> {
  if (!input.deliveryId) {
    throw new ValidationError('Cannot enqueue review intent without a GitHub delivery id.');
  }

  const [intent] = await context.db
    .insert(reviewIntent)
    .values({
      id: createReviewIntentId(),
      deliveryId: input.deliveryId,
      kind: input.kind,
      repositoryId: input.repositoryId,
      prNumber: input.prNumber,
      headSha: input.headSha ?? null,
      prState: input.prState ?? null,
    })
    .onConflictDoNothing({
      target: [
        reviewIntent.deliveryId,
        reviewIntent.kind,
        reviewIntent.repositoryId,
        reviewIntent.prNumber,
      ],
    })
    .returning();

  return { enqueued: intent !== undefined, intent };
}

export async function signalPullRequestEvent(
  context: GithubServiceContext,
  input: SignalPullRequestEventInput,
): Promise<SignalPullRequestResult> {
  const workflowId = buildPullRequestOrchestratorWorkflowId(input.repositoryId, input.prNumber);
  const intentKind = mapPullRequestEventToReviewIntentKind(input.eventType);

  if (!intentKind) {
    return { ok: true, workflowId, enqueued: false };
  }

  try {
    const { enqueued, intent } = await enqueueReviewIntent(context, {
      deliveryId: input.eventId,
      kind: intentKind,
      repositoryId: input.repositoryId,
      prNumber: input.prNumber,
      headSha: input.headSha,
    });

    return {
      ok: true,
      workflowId,
      intentId: intent?.id,
      intentKind,
      enqueued,
    };
  } catch (error) {
    return { ok: false, workflowId, intentKind, enqueued: false, error: formatError(error) };
  }
}

export async function signalPullRequestClosed(
  context: GithubServiceContext,
  input: SignalPullRequestClosedInput,
): Promise<SignalPullRequestResult> {
  const workflowId = buildPullRequestOrchestratorWorkflowId(input.repositoryId, input.prNumber);

  try {
    const { enqueued, intent } = await enqueueReviewIntent(context, {
      deliveryId: input.eventId,
      kind: 'pr_closed',
      repositoryId: input.repositoryId,
      prNumber: input.prNumber,
      headSha: input.headSha,
      prState: input.merged ? 'merged' : 'closed',
    });

    return {
      ok: true,
      workflowId,
      intentId: intent?.id,
      intentKind: 'pr_closed',
      enqueued,
    };
  } catch (error) {
    return {
      ok: false,
      workflowId,
      intentKind: 'pr_closed',
      enqueued: false,
      error: formatError(error),
    };
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
