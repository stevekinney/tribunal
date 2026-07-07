import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  githubInstallation,
  githubInstallationRepository,
  repositoryReviewSettings,
  reviewIntent,
  type ReviewIntent,
  userReviewSettings,
} from '@tribunal/database/schema';
import type { GithubServiceContext } from '../../context.js';
import { ValidationError } from '../../error-taxonomy.js';
import { createCheckRun, type CheckRunActionInput } from '../../reviews/check-runs.js';
import { RE_REVIEW_ACTION_IDENTIFIER } from '../../webhooks/re-run-triggers.js';

/** Check Run name shown on the pull request — stable and unique for required-status-check matching. */
const CHECK_RUN_NAME = 'Tribunal Review';

/** The "Re-review" action button attached to every Tribunal Check Run. */
const RE_REVIEW_CHECK_RUN_ACTION: CheckRunActionInput = {
  label: 'Re-review',
  description: 'Run Tribunal review again',
  identifier: RE_REVIEW_ACTION_IDENTIFIER,
};

type ReviewIntentKind = 'start' | 'commit_pushed' | 'pr_closed' | 'manual';
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

export type ReviewIntentEnqueueStatus = 'enqueued' | 'duplicate' | 'no_watchers';

export interface SignalPullRequestEventInput {
  repositoryId: number;
  prNumber: number;
  installationId: number;
  owner: string;
  repo: string;
  eventType: PullRequestEventType;
  actorLogin?: string;
  eventId?: string;
  headSha?: string | null;
  /** The app's public origin, used to build the Check Run's `details_url`. */
  origin?: string;
}

export interface SignalPullRequestClosedInput {
  repositoryId: number;
  prNumber: number;
  merged: boolean;
  actorLogin?: string;
  eventId?: string;
  headSha?: string | null;
}

export interface SignalManualReviewInput {
  repositoryId: number;
  prNumber: number;
  headSha: string;
  actorLogin?: string;
  eventId?: string;
  /**
   * The Check Run this manual trigger resolves against (`check_run.rerequested`
   * / `requested_action` carry their own check run id) — reused instead of
   * creating a fresh one. Omit for triggers with no single associated check
   * run (e.g. `check_suite.rerequested`, `@tribunal review`).
   */
  checkRunId?: number;
}

export interface SignalPullRequestResult {
  ok: boolean;
  workflowId: string;
  intentId?: string;
  intentKind?: ReviewIntentKind;
  enqueued: boolean;
  enqueueStatus?: ReviewIntentEnqueueStatus;
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
    /** Pre-existing Check Run to reuse (e.g. the "Re-review" action's own check run). */
    checkRunId?: number | null;
  },
): Promise<{ status: ReviewIntentEnqueueStatus; intent?: ReviewIntent; intents?: ReviewIntent[] }> {
  if (!input.deliveryId) {
    throw new ValidationError('Cannot enqueue review intent without a GitHub delivery id.');
  }
  const deliveryId = input.deliveryId;

  const watchedUsers = await context.db
    .selectDistinct({ userId: sql<number>`${githubInstallation.userId}` })
    .from(githubInstallationRepository)
    .innerJoin(
      githubInstallation,
      and(
        eq(githubInstallation.installationId, githubInstallationRepository.installationId),
        eq(githubInstallation.status, 'active'),
      ),
    )
    .innerJoin(
      repositoryReviewSettings,
      and(
        eq(repositoryReviewSettings.repositoryId, githubInstallationRepository.repositoryId),
        eq(repositoryReviewSettings.userId, githubInstallation.userId),
        eq(repositoryReviewSettings.watched, true),
      ),
    )
    .innerJoin(
      userReviewSettings,
      and(
        eq(userReviewSettings.userId, githubInstallation.userId),
        eq(userReviewSettings.reviewsEnabled, true),
      ),
    )
    .where(
      and(
        eq(githubInstallationRepository.repositoryId, input.repositoryId),
        eq(githubInstallationRepository.isActive, true),
      ),
    )
    .orderBy(asc(githubInstallation.userId));

  const watchedUserIds = watchedUsers.map(({ userId }) => userId);
  if (watchedUserIds.length === 0) {
    return { status: 'no_watchers' };
  }

  const intents = await context.db
    .insert(reviewIntent)
    .values(
      watchedUserIds.map((userId) => ({
        id: createReviewIntentId(),
        deliveryId,
        kind: input.kind,
        repositoryId: input.repositoryId,
        userId,
        prNumber: input.prNumber,
        headSha: input.headSha ?? null,
        prState: input.prState ?? null,
        checkRunId: input.checkRunId ?? null,
      })),
    )
    .onConflictDoNothing({
      target: [
        reviewIntent.deliveryId,
        reviewIntent.kind,
        reviewIntent.userId,
        reviewIntent.repositoryId,
        reviewIntent.prNumber,
      ],
    })
    .returning();

  if (intents.length === 0) return { status: 'duplicate' };
  return { status: 'enqueued', intent: intents[0], intents };
}

/**
 * Create the "Tribunal Review" Check Run for a fresh review intent and stamp
 * its id onto every intent row this delivery enqueued (one check run per
 * delivery/head_sha, shared across all watching users — not one per user).
 *
 * This is a write, so it is not routed through `cachedRead`
 * (see `.claude/rules/github-api.md`). Failure here must not fail intent
 * enqueue: the intent already exists durably, and the engine still creates a
 * fallback Check Run at claim time if this one is missing (T-2).
 */
async function createCheckRunForEnqueuedIntents(
  context: GithubServiceContext,
  intents: ReviewIntent[],
  input: {
    installationId: number;
    owner: string;
    repo: string;
    headSha?: string | null;
    origin?: string;
  },
): Promise<void> {
  if (intents.length === 0 || !input.headSha) return;

  const intentId = intents[0].id;
  try {
    const checkRun = await createCheckRun(context, {
      installationId: input.installationId,
      owner: input.owner,
      repository: input.repo,
      name: CHECK_RUN_NAME,
      headSha: input.headSha,
      status: 'queued',
      externalId: intentId,
      detailsUrl: input.origin ? `${input.origin}/runs/${intentId}` : undefined,
      actions: [RE_REVIEW_CHECK_RUN_ACTION],
    });

    await context.db
      .update(reviewIntent)
      .set({ checkRunId: checkRun.id })
      .where(
        inArray(
          reviewIntent.id,
          intents.map((intent) => intent.id),
        ),
      );
  } catch (error) {
    console.error('[review-intent] Failed to create Check Run at intent time:', {
      owner: input.owner,
      repo: input.repo,
      error,
    });
  }
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
    const { status, intent, intents } = await enqueueReviewIntent(context, {
      deliveryId: input.eventId,
      kind: intentKind,
      repositoryId: input.repositoryId,
      prNumber: input.prNumber,
      headSha: input.headSha,
    });

    if (status === 'enqueued' && intents !== undefined) {
      await createCheckRunForEnqueuedIntents(context, intents, {
        installationId: input.installationId,
        owner: input.owner,
        repo: input.repo,
        headSha: input.headSha,
        origin: input.origin,
      });
    }

    return {
      ok: true,
      workflowId,
      intentId: intent?.id,
      intentKind,
      enqueued: status === 'enqueued',
      enqueueStatus: status,
    };
  } catch (error) {
    return { ok: false, workflowId, intentKind, enqueued: false, error: formatError(error) };
  }
}

/**
 * Enqueue a `manual`-trigger review intent — the re-run path for
 * `check_run.rerequested`, `check_run.requested_action` (identifier
 * `re-review`), and `check_suite.rerequested`. Reuses `enqueueReviewIntent`'s
 * fan-out (one intent per watched user) and idempotency (unique on
 * deliveryId+kind+user+repository+PR), so a redelivered webhook cannot
 * duplicate the manual intent.
 */
export async function signalManualReview(
  context: GithubServiceContext,
  input: SignalManualReviewInput,
): Promise<SignalPullRequestResult> {
  const workflowId = buildPullRequestOrchestratorWorkflowId(input.repositoryId, input.prNumber);

  try {
    const { status, intent } = await enqueueReviewIntent(context, {
      deliveryId: input.eventId,
      kind: 'manual',
      repositoryId: input.repositoryId,
      prNumber: input.prNumber,
      headSha: input.headSha,
      checkRunId: input.checkRunId,
    });

    return {
      ok: true,
      workflowId,
      intentId: intent?.id,
      intentKind: 'manual',
      enqueued: status === 'enqueued',
      enqueueStatus: status,
    };
  } catch (error) {
    return {
      ok: false,
      workflowId,
      intentKind: 'manual',
      enqueued: false,
      error: formatError(error),
    };
  }
}

export async function signalPullRequestClosed(
  context: GithubServiceContext,
  input: SignalPullRequestClosedInput,
): Promise<SignalPullRequestResult> {
  const workflowId = buildPullRequestOrchestratorWorkflowId(input.repositoryId, input.prNumber);

  try {
    const { status, intent } = await enqueueReviewIntent(context, {
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
      enqueued: status === 'enqueued',
      enqueueStatus: status,
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
