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
const defaultMaxSkippedReviewIntentsPerClaim = 25;
const backoffMinutesByFailureCount = [1, 2, 4, 8] as const;
const waitingForEligibleReviewAgentReason =
  'Review intent is waiting for an eligible review agent.';

type ClaimedReviewIntentRow = {
  id: string;
  deliveryId: string;
  kind: ReviewIntentKind;
  repositoryId: number;
  userId: number;
  prNumber: number;
  headSha: string | null;
  prState: 'merged' | 'closed' | null;
  createdAt: Date;
  claimedAt: Date;
  lastError: string | null;
  /** Check Run created at webhook-intent time (T-1); null for intents that predate it. */
  checkRunId: number | null;
};

type PullRequestReviewInputBuildResult =
  | { status: 'ready'; pullRequest: PullRequestReviewInput }
  | { status: 'missing_target' }
  | { status: 'temporarily_unavailable'; reason: string };

export type ReviewIntentPortOptions = {
  reviewsEnabled?: boolean;
  maxSkippedReviewIntentsPerClaim?: number;
};

export type ReviewIntentQueueStatus = {
  readyCount: number;
  deferredCount: number;
  claimedCount: number;
  nextAttemptAt?: Date;
};

export function createDatabaseReviewIntentPort(
  database: ReviewIntentDatabase,
  options: ReviewIntentPortOptions = {},
): ReviewIntentPort {
  let skippedReviewIntentLimitReached = false;
  return {
    async claimNextReviewIntent(now: Date) {
      if (options.reviewsEnabled === false) return null;
      skippedReviewIntentLimitReached = false;
      const maxSkippedReviewIntentsPerClaim =
        options.maxSkippedReviewIntentsPerClaim === undefined ||
        options.maxSkippedReviewIntentsPerClaim <= 0
          ? defaultMaxSkippedReviewIntentsPerClaim
          : options.maxSkippedReviewIntentsPerClaim;
      let skippedReviewIntents = 0;

      while (skippedReviewIntents < maxSkippedReviewIntentsPerClaim) {
        const row = await claimNextIntentRow(database, now);
        if (row === null) return null;

        const normalizedRow = normalizeClaimedReviewIntentRow(row);
        const result = await buildPullRequestReviewInput(database, normalizedRow);
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
            normalizedRow.lastError,
          );
          skippedReviewIntents += 1;
          continue;
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
      }

      skippedReviewIntentLimitReached = true;
      return null;
    },
    consumeSkippedReviewIntentLimitReached() {
      const limitReached = skippedReviewIntentLimitReached;
      skippedReviewIntentLimitReached = false;
      return limitReached;
    },
    markReviewIntentProcessed(intentId: string, claimedAt: Date, now: Date) {
      return markReviewIntentProcessed(database, intentId, claimedAt, now);
    },
    markReviewIntentFailed(intentId: string, claimedAt: Date, now: Date, error: unknown) {
      return markReviewIntentFailed(database, intentId, claimedAt, now, error);
    },
  };
}

export async function getReviewIntentQueueStatus(
  database: ReviewIntentDatabase,
  now: Date,
  options: ReviewIntentPortOptions = {},
): Promise<ReviewIntentQueueStatus> {
  if (options.reviewsEnabled === false) {
    return { readyCount: 0, deferredCount: 0, claimedCount: 0 };
  }

  const staleClaimCutoff = new Date(now.getTime() - 5 * 60 * 1000);
  const result = await database.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE ${reviewIntent.nextAttemptAt} IS NULL
          OR ${reviewIntent.nextAttemptAt} <= ${now}
      )::int AS "readyCount",
      COUNT(*) FILTER (
        WHERE ${reviewIntent.nextAttemptAt} > ${now}
      )::int AS "deferredCount",
      MIN(${reviewIntent.nextAttemptAt}) FILTER (
        WHERE ${reviewIntent.nextAttemptAt} > ${now}
      ) AS "nextAttemptAt",
      (
        SELECT COUNT(*)::int
        FROM ${reviewIntent}
        WHERE ${reviewIntent.processedAt} IS NULL
          AND ${reviewIntent.deadLetteredAt} IS NULL
          AND ${reviewIntent.claimedAt} IS NOT NULL
          AND ${reviewIntent.claimedAt} >= ${staleClaimCutoff}
      ) AS "claimedCount"
    FROM ${reviewIntent}
    INNER JOIN ${repositoryReviewSettings}
      ON ${repositoryReviewSettings.repositoryId} = ${reviewIntent.repositoryId}
      AND ${repositoryReviewSettings.userId} = ${reviewIntent.userId}
    INNER JOIN ${repository}
      ON ${repository.id} = ${reviewIntent.repositoryId}
    INNER JOIN ${githubInstallationRepository}
      ON ${githubInstallationRepository.repositoryId} = ${repository.id}
      AND ${githubInstallationRepository.isActive} = true
    INNER JOIN ${githubInstallation}
      ON ${githubInstallation.installationId} = ${githubInstallationRepository.installationId}
      AND ${githubInstallation.userId} = ${reviewIntent.userId}
    INNER JOIN ${userReviewSettings}
      ON ${userReviewSettings.userId} = ${reviewIntent.userId}
    WHERE ${reviewIntent.processedAt} IS NULL
      AND (
        ${reviewIntent.claimedAt} IS NULL
        OR ${reviewIntent.claimedAt} < ${staleClaimCutoff}
      )
      AND ${reviewIntent.deadLetteredAt} IS NULL
      AND (
        ${reviewIntent.lastError} IS NULL
        OR ${reviewIntent.lastError} IS DISTINCT FROM ${waitingForEligibleReviewAgentReason}
      )
      AND ${repositoryReviewSettings.watched} = true
      AND ${userReviewSettings.reviewsEnabled} = true
      AND ${githubInstallation.status} = 'active'
  `);

  const row = getRows<{
    readyCount: number | string | bigint | null;
    deferredCount: number | string | bigint | null;
    claimedCount: number | string | bigint | null;
    nextAttemptAt: Date | string | null;
  }>(result)[0];

  return {
    readyCount: toCount(row?.readyCount),
    deferredCount: toCount(row?.deferredCount),
    claimedCount: toCount(row?.claimedCount),
    ...(row?.nextAttemptAt === null || row?.nextAttemptAt === undefined
      ? {}
      : { nextAttemptAt: toDate(row.nextAttemptAt) }),
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
        AND ${repositoryReviewSettings.userId} = ${reviewIntent.userId}
      INNER JOIN ${repository}
        ON ${repository.id} = ${reviewIntent.repositoryId}
      INNER JOIN ${githubInstallationRepository}
        ON ${githubInstallationRepository.repositoryId} = ${repository.id}
        AND ${githubInstallationRepository.isActive} = true
      INNER JOIN ${githubInstallation}
        ON ${githubInstallation.installationId} = ${githubInstallationRepository.installationId}
        AND ${githubInstallation.userId} = ${reviewIntent.userId}
      INNER JOIN ${userReviewSettings}
        ON ${userReviewSettings.userId} = ${reviewIntent.userId}
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
      ${reviewIntent.userId} AS "userId",
      ${reviewIntent.prNumber} AS "prNumber",
      ${reviewIntent.headSha} AS "headSha",
      ${reviewIntent.prState} AS "prState",
      ${reviewIntent.createdAt} AS "createdAt",
      ${reviewIntent.claimedAt} AS "claimedAt",
      ${reviewIntent.lastError} AS "lastError",
      ${reviewIntent.checkRunId} AS "checkRunId"
  `);

  return getRows<ClaimedReviewIntentRow>(result)[0] ?? null;
}

async function buildPullRequestReviewInput(
  database: ReviewIntentDatabase,
  intent: ClaimedReviewIntentRow,
): Promise<PullRequestReviewInputBuildResult> {
  const [target] = await database
    .select({
      userId: reviewIntent.userId,
      installationId: githubInstallation.installationId,
      owner: repository.owner,
      name: repository.name,
      headSha: reviewIntent.headSha,
      currentHeadSha: pullRequestState.headSha,
      ignoreGlobs: repositoryReviewSettings.ignoreGlobs,
      checkConclusionMode: repositoryReviewSettings.checkConclusionMode,
      defaultModel: userReviewSettings.defaultModel,
    })
    .from(reviewIntent)
    .innerJoin(repository, eq(repository.id, reviewIntent.repositoryId))
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
        eq(githubInstallation.userId, reviewIntent.userId),
        eq(githubInstallation.status, 'active'),
      ),
    )
    .innerJoin(
      repositoryReviewSettings,
      and(
        eq(repositoryReviewSettings.repositoryId, reviewIntent.repositoryId),
        eq(repositoryReviewSettings.userId, reviewIntent.userId),
      ),
    )
    .innerJoin(userReviewSettings, eq(userReviewSettings.userId, reviewIntent.userId))
    .leftJoin(
      pullRequestState,
      and(
        eq(pullRequestState.repositoryId, reviewIntent.repositoryId),
        eq(pullRequestState.prNumber, reviewIntent.prNumber),
      ),
    )
    .where(
      and(
        eq(reviewIntent.id, intent.id),
        eq(reviewIntent.userId, intent.userId),
        eq(repositoryReviewSettings.watched, true),
        eq(userReviewSettings.reviewsEnabled, true),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${githubInstallation.installationId} = ${repository.installationId} THEN 0 ELSE 1 END`,
      asc(githubInstallation.installationId),
      asc(githubInstallation.userId),
    )
    .limit(1);

  if (!target) return { status: 'missing_target' };

  const repositoryAssignedAgents = await database
    .select({
      id: agent.id,
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
        eq(repositoryAgent.userId, target.userId),
        eq(agent.userId, target.userId),
      ),
    )
    .orderBy(asc(agent.slug));
  const assignedAgents = repositoryAssignedAgents.filter((agentRow) => agentRow.enabled);
  const agents =
    repositoryAssignedAgents.length > 0
      ? assignedAgents
      : await selectEnabledUserAgents(database, target.userId);

  const headSha = intent.headSha ?? target.headSha ?? target.currentHeadSha;
  if (!headSha) {
    return {
      status: 'temporarily_unavailable',
      reason: 'Review intent is waiting for a pull request head SHA.',
    };
  }
  if (agents.length === 0 && intent.kind !== 'pr_closed') {
    return {
      status: 'temporarily_unavailable',
      reason: waitingForEligibleReviewAgentReason,
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
      defaultModel: target.defaultModel,
      ignoreGlobs: target.ignoreGlobs,
      checkConclusionMode: toCheckConclusionMode(target.checkConclusionMode),
      ...(intent.checkRunId === null ? {} : { checkRunId: intent.checkRunId }),
    },
  };
}

function toCheckConclusionMode(value: string): PullRequestReviewInput['checkConclusionMode'] {
  return value === 'gating' ? 'gating' : 'advisory';
}

function markReviewIntentProcessed(
  database: ReviewIntentDatabase,
  intentId: string,
  claimedAt: Date,
  now: Date,
): Promise<boolean> {
  const update = database
    .update(reviewIntent)
    .set({
      processedAt: now,
      failureCount: 0,
      lastError: null,
      nextAttemptAt: null,
      deadLetteredAt: null,
    })
    .where(
      and(
        eq(reviewIntent.id, intentId),
        eq(reviewIntent.claimedAt, claimedAt),
        isNull(reviewIntent.processedAt),
      ),
    );
  if ('returning' in update && typeof update.returning === 'function') {
    return update.returning({ id: reviewIntent.id }).then((rows) => rows.length > 0);
  }
  return Promise.resolve(update).then(() => true);
}

async function deferReviewIntentRetry(
  database: ReviewIntentDatabase,
  intentId: string,
  claimedAt: Date,
  now: Date,
  reason: string,
  previousLastError: string | null,
): Promise<void> {
  const unchangedErrorCondition =
    previousLastError === null
      ? isNull(reviewIntent.lastError)
      : eq(reviewIntent.lastError, previousLastError);
  const stillWaitingCondition =
    reason === waitingForEligibleReviewAgentReason
      ? reviewIntentStillWaitingForEligibleAgentsCondition()
      : sql`true`;

  await database
    .update(reviewIntent)
    .set({
      claimedAt: null,
      lastError: reason,
      nextAttemptAt: new Date(now.getTime() + backoffMinutesForFailure(1) * 60 * 1000),
    })
    .where(
      and(
        eq(reviewIntent.id, intentId),
        eq(reviewIntent.claimedAt, claimedAt),
        unchangedErrorCondition,
        stillWaitingCondition,
        isNull(reviewIntent.processedAt),
      ),
    );

  if (reason === waitingForEligibleReviewAgentReason) {
    await releaseReviewIntentIfEligibleAgentsAvailable(database, intentId, claimedAt);
  }
}

function reviewIntentStillWaitingForEligibleAgentsCondition() {
  return sql`
    NOT (
      EXISTS (
        SELECT 1
        FROM ${repositoryAgent} assigned_repository_agent
        INNER JOIN ${agent} assigned_agent
          ON assigned_agent.id = assigned_repository_agent.agent_id
          AND assigned_agent.user_id = ${reviewIntent.userId}
          AND assigned_agent.enabled = true
        WHERE assigned_repository_agent.repository_id = ${reviewIntent.repositoryId}
          AND assigned_repository_agent.user_id = ${reviewIntent.userId}
      )
      OR (
        NOT EXISTS (
          SELECT 1
          FROM ${repositoryAgent} any_repository_agent
          WHERE any_repository_agent.repository_id = ${reviewIntent.repositoryId}
            AND any_repository_agent.user_id = ${reviewIntent.userId}
        )
        AND EXISTS (
          SELECT 1
          FROM ${agent} user_agent
          WHERE user_agent.user_id = ${reviewIntent.userId}
            AND user_agent.enabled = true
        )
      )
    )
  `;
}

async function releaseReviewIntentIfEligibleAgentsAvailable(
  database: ReviewIntentDatabase,
  intentId: string,
  claimedAt: Date,
): Promise<void> {
  await database
    .update(reviewIntent)
    .set({
      claimedAt: null,
      lastError: null,
      nextAttemptAt: null,
    })
    .where(
      and(
        eq(reviewIntent.id, intentId),
        eq(reviewIntent.claimedAt, claimedAt),
        sql`NOT (${reviewIntentStillWaitingForEligibleAgentsCondition()})`,
        isNull(reviewIntent.processedAt),
      ),
    );
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
  if (intent.processedAt !== null) return;

  const failureCount = intent.failureCount + 1;
  const deadLetteredAt = failureCount >= maxReviewIntentFailures ? now : null;
  const nextAttemptAt =
    deadLetteredAt === null
      ? new Date(now.getTime() + backoffMinutesForFailure(failureCount) * 60 * 1000)
      : null;

  await database
    .update(reviewIntent)
    .set({
      claimedAt: null,
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

function selectEnabledUserAgents(
  database: ReviewIntentDatabase,
  userId: number,
): Promise<
  Array<{
    id: string;
    userId: number;
    slug: string;
    description: string;
    body: string;
    model: string;
    effort: string | null;
    enabled: boolean;
  }>
> {
  return database
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
    .from(agent)
    .where(and(eq(agent.userId, userId), eq(agent.enabled, true)))
    .orderBy(asc(agent.slug));
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
  if (kind === 'manual') return 'manual';
  // pr_closed intents never reach startReviewRun (routed to
  // signalPullRequestClosed instead), so this trigger value is unused for
  // them; 'manual' is a harmless placeholder matching the review_run enum.
  return 'manual';
}

function toAgentSpec(row: {
  id: string;
  slug: string;
  description: string;
  body: string;
  model: string;
  effort: string | null;
  enabled: boolean;
}): AgentSpec {
  return {
    id: row.id,
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

function toCount(value: number | string | bigint | null | undefined): number {
  const count =
    typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string'
      ? Number(value)
      : 0;
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
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
