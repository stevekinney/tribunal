import type { Database } from '@tribunal/database';
import { and, asc, eq, isNull, sql } from '@tribunal/database/operators';
import {
  agent,
  githubInstallation,
  githubInstallationRepository,
  pullRequestState,
  repository,
  repositoryAgent,
  repositoryReviewSettings,
  reviewIntent,
  userReviewSettings,
} from '@tribunal/database/schema';
import type { AgentSpec } from '@tribunal/review-core';
import type { PullRequestReviewInput, ReviewIntentKind, ReviewIntentPort } from './review-workflow';

type ReviewIntentDatabase = Pick<Database, 'execute' | 'select' | 'update'>;

const maxReviewIntentFailures = 5;
const backoffMinutesByFailureCount = [1, 2, 4, 8] as const;

type ClaimedReviewIntentRow = {
  id: string;
  deliveryId: string;
  kind: ReviewIntentKind;
  repositoryId: number;
  prNumber: number;
  headSha: string | null;
  prState: 'merged' | 'closed' | null;
  createdAt: Date;
  claimedAt: Date;
};

type PullRequestReviewInputBuildResult =
  | { status: 'ready'; pullRequest: PullRequestReviewInput }
  | { status: 'missing_target' }
  | { status: 'temporarily_unavailable'; reason: string };

export type ReviewIntentPortOptions = {
  defaultDailyCostCapUsd: number;
  reviewsEnabled?: boolean;
};

export function createDatabaseReviewIntentPort(
  database: ReviewIntentDatabase,
  options: ReviewIntentPortOptions,
): ReviewIntentPort {
  return {
    async claimNextReviewIntent(now: Date) {
      if (options.reviewsEnabled === false) return null;
      const row = await claimNextIntentRow(database, now);
      if (row === null) return null;

      const normalizedRow = normalizeClaimedReviewIntentRow(row);
      const result = await buildPullRequestReviewInput(database, normalizedRow, options);
      if (result.status === 'missing_target') {
        await markReviewIntentProcessed(database, normalizedRow.id, normalizedRow.claimedAt, now);
        return null;
      }
      if (result.status === 'temporarily_unavailable') {
        await deferReviewIntentRetry(
          database,
          normalizedRow.id,
          normalizedRow.claimedAt,
          now,
          result.reason,
        );
        return null;
      }

      return {
        id: normalizedRow.id,
        deliveryId: normalizedRow.deliveryId,
        kind: normalizedRow.kind,
        pullRequest: result.pullRequest,
        prState: normalizedRow.prState ?? undefined,
        createdAt: normalizedRow.createdAt,
        claimedAt: normalizedRow.claimedAt,
      };
    },
    markReviewIntentProcessed(intentId: string, claimedAt: Date, now: Date) {
      return markReviewIntentProcessed(database, intentId, claimedAt, now);
    },
    markReviewIntentFailed(intentId: string, claimedAt: Date, now: Date, error: unknown) {
      return markReviewIntentFailed(database, intentId, claimedAt, now, error);
    },
  };
}

async function claimNextIntentRow(
  database: ReviewIntentDatabase,
  now: Date,
): Promise<ClaimedReviewIntentRow | null> {
  const staleClaimCutoff = new Date(now.getTime() - 5 * 60 * 1000);
  const result = await database.execute(sql`
    WITH next_intent AS (
      SELECT ${reviewIntent.id}
      FROM ${reviewIntent}
      INNER JOIN ${repositoryReviewSettings}
        ON ${repositoryReviewSettings.repositoryId} = ${reviewIntent.repositoryId}
      INNER JOIN ${repository}
        ON ${repository.id} = ${reviewIntent.repositoryId}
      INNER JOIN ${githubInstallationRepository}
        ON ${githubInstallationRepository.repositoryId} = ${repository.id}
        AND ${githubInstallationRepository.isActive} = true
      INNER JOIN ${githubInstallation}
        ON ${githubInstallation.installationId} = ${githubInstallationRepository.installationId}
      INNER JOIN ${userReviewSettings}
        ON ${userReviewSettings.userId} = ${githubInstallation.userId}
      WHERE ${reviewIntent.processedAt} IS NULL
        AND (
          ${reviewIntent.claimedAt} IS NULL
          OR ${reviewIntent.claimedAt} < ${staleClaimCutoff}
        )
        AND ${reviewIntent.deadLetteredAt} IS NULL
        AND (
          ${reviewIntent.nextAttemptAt} IS NULL
          OR ${reviewIntent.nextAttemptAt} <= ${now}
        )
        AND ${repositoryReviewSettings.watched} = true
        AND ${userReviewSettings.reviewsEnabled} = true
        AND ${githubInstallation.status} = 'active'
      ORDER BY ${reviewIntent.createdAt}, ${reviewIntent.id}
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${reviewIntent}
    SET "claimed_at" = ${now}
    FROM next_intent
    WHERE ${reviewIntent.id} = next_intent.id
    RETURNING
      ${reviewIntent.id} AS "id",
      ${reviewIntent.deliveryId} AS "deliveryId",
      ${reviewIntent.kind} AS "kind",
      ${reviewIntent.repositoryId} AS "repositoryId",
      ${reviewIntent.prNumber} AS "prNumber",
      ${reviewIntent.headSha} AS "headSha",
      ${reviewIntent.prState} AS "prState",
      ${reviewIntent.createdAt} AS "createdAt",
      ${reviewIntent.claimedAt} AS "claimedAt"
  `);

  return getRows<ClaimedReviewIntentRow>(result)[0] ?? null;
}

async function buildPullRequestReviewInput(
  database: ReviewIntentDatabase,
  intent: ClaimedReviewIntentRow,
  options: ReviewIntentPortOptions,
): Promise<PullRequestReviewInputBuildResult> {
  const [target] = await database
    .select({
      userId: githubInstallation.userId,
      installationId: githubInstallation.installationId,
      owner: repository.owner,
      name: repository.name,
      headSha: reviewIntent.headSha,
      currentHeadSha: pullRequestState.headSha,
      dailyCostCapUsd: userReviewSettings.dailyCostCapUsd,
      ignoreGlobs: repositoryReviewSettings.ignoreGlobs,
    })
    .from(reviewIntent)
    .innerJoin(repository, eq(repository.id, reviewIntent.repositoryId))
    .innerJoin(
      repositoryReviewSettings,
      eq(repositoryReviewSettings.repositoryId, reviewIntent.repositoryId),
    )
    .innerJoin(
      githubInstallationRepository,
      and(
        eq(githubInstallationRepository.repositoryId, repository.id),
        eq(githubInstallationRepository.isActive, true),
      ),
    )
    .innerJoin(
      githubInstallation,
      and(
        eq(githubInstallation.installationId, githubInstallationRepository.installationId),
        eq(githubInstallation.status, 'active'),
      ),
    )
    .innerJoin(userReviewSettings, eq(userReviewSettings.userId, githubInstallation.userId))
    .leftJoin(
      pullRequestState,
      and(
        eq(pullRequestState.repositoryId, reviewIntent.repositoryId),
        eq(pullRequestState.prNumber, reviewIntent.prNumber),
      ),
    )
    .where(eq(reviewIntent.id, intent.id))
    .limit(1);

  if (!target?.userId) return { status: 'missing_target' };

  const agents = await database
    .select({
      id: agent.id,
      userId: agent.userId,
      slug: agent.slug,
      description: agent.description,
      body: agent.body,
      model: agent.model,
      effort: agent.effort,
      enabled: agent.enabled,
    })
    .from(repositoryAgent)
    .innerJoin(agent, eq(agent.id, repositoryAgent.agentId))
    .where(
      and(
        eq(repositoryAgent.repositoryId, intent.repositoryId),
        eq(agent.userId, target.userId),
        eq(agent.enabled, true),
      ),
    )
    .orderBy(asc(agent.slug));

  const headSha = intent.headSha ?? target.headSha ?? target.currentHeadSha;
  if (!headSha) {
    return {
      status: 'temporarily_unavailable',
      reason: 'Review intent is waiting for a pull request head SHA.',
    };
  }
  if (agents.length === 0) {
    return {
      status: 'temporarily_unavailable',
      reason: 'Review intent is waiting for an eligible review agent.',
    };
  }

  return {
    status: 'ready',
    pullRequest: {
      userId: target.userId,
      repositoryId: intent.repositoryId,
      installationId: target.installationId,
      repository: { owner: target.owner, name: target.name },
      pullRequestNumber: intent.prNumber,
      headSha,
      trigger: toReviewTrigger(intent.kind),
      agents: agents.map(toAgentSpec),
      dailyCostCapUsd: Number(target.dailyCostCapUsd ?? options.defaultDailyCostCapUsd),
      ignoreGlobs: target.ignoreGlobs,
    },
  };
}

function markReviewIntentProcessed(
  database: ReviewIntentDatabase,
  intentId: string,
  claimedAt: Date,
  now: Date,
): Promise<void> {
  return database
    .update(reviewIntent)
    .set({ processedAt: now })
    .where(
      and(
        eq(reviewIntent.id, intentId),
        eq(reviewIntent.claimedAt, claimedAt),
        isNull(reviewIntent.processedAt),
      ),
    )
    .then(() => {});
}

function deferReviewIntentRetry(
  database: ReviewIntentDatabase,
  intentId: string,
  claimedAt: Date,
  now: Date,
  reason: string,
): Promise<void> {
  return database
    .update(reviewIntent)
    .set({
      claimedAt: null,
      failedAt: now,
      lastError: reason,
      nextAttemptAt: new Date(now.getTime() + backoffMinutesForFailure(1) * 60 * 1000),
    })
    .where(
      and(
        eq(reviewIntent.id, intentId),
        eq(reviewIntent.claimedAt, claimedAt),
        isNull(reviewIntent.processedAt),
      ),
    )
    .then(() => {});
}

async function markReviewIntentFailed(
  database: ReviewIntentDatabase,
  intentId: string,
  claimedAt: Date,
  now: Date,
  error: unknown,
): Promise<void> {
  const [intent] = await database
    .select({ failureCount: reviewIntent.failureCount, processedAt: reviewIntent.processedAt })
    .from(reviewIntent)
    .where(and(eq(reviewIntent.id, intentId), eq(reviewIntent.claimedAt, claimedAt)))
    .limit(1);
  if (intent === undefined) return;

  const failureCount = intent.failureCount + 1;
  if (intent.processedAt !== null) {
    await database
      .update(reviewIntent)
      .set({
        failedAt: now,
        failureCount,
        lastError: serializeReviewIntentError(error),
      })
      .where(and(eq(reviewIntent.id, intentId), eq(reviewIntent.claimedAt, claimedAt)))
      .then(() => {});
    return;
  }

  const deadLetteredAt = failureCount >= maxReviewIntentFailures ? now : null;
  const nextAttemptAt =
    deadLetteredAt === null
      ? new Date(now.getTime() + backoffMinutesForFailure(failureCount) * 60 * 1000)
      : null;

  await database
    .update(reviewIntent)
    .set({
      claimedAt: null,
      failedAt: now,
      failureCount,
      lastError: serializeReviewIntentError(error),
      nextAttemptAt,
      deadLetteredAt,
    })
    .where(
      and(
        eq(reviewIntent.id, intentId),
        eq(reviewIntent.claimedAt, claimedAt),
        isNull(reviewIntent.processedAt),
      ),
    )
    .then(() => {});
}

function backoffMinutesForFailure(failureCount: number): number {
  return (
    backoffMinutesByFailureCount[
      Math.min(failureCount - 1, backoffMinutesByFailureCount.length - 1)
    ] ?? backoffMinutesByFailureCount.at(-1)!
  );
}

function serializeReviewIntentError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}

function toReviewTrigger(kind: ReviewIntentKind): PullRequestReviewInput['trigger'] {
  if (kind === 'commit_pushed') return 'synchronize';
  if (kind === 'start') return 'opened';
  return 'manual';
}

function toAgentSpec(row: {
  id: string;
  userId: number;
  slug: string;
  description: string;
  body: string;
  model: string;
  effort: string | null;
  enabled: boolean;
}): AgentSpec {
  return {
    id: row.id,
    userId: row.userId,
    slug: row.slug,
    description: row.description,
    body: row.body,
    model: row.model,
    ...(row.effort ? { effort: row.effort as AgentSpec['effort'] } : {}),
    enabled: row.enabled,
  };
}

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function normalizeClaimedReviewIntentRow(row: ClaimedReviewIntentRow): ClaimedReviewIntentRow {
  return {
    ...row,
    createdAt: toDate(row.createdAt),
    claimedAt: toDate(row.claimedAt),
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
