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
import type {
  ClaimedReviewIntent,
  PullRequestReviewInput,
  ReviewIntentKind,
  ReviewIntentPort,
} from './review-workflow';

type ReviewIntentDatabase = Pick<Database, 'execute' | 'select' | 'update'>;

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

export type ReviewIntentPortOptions = {
  defaultDailyCostCapUsd: number;
};

export function createDatabaseReviewIntentPort(
  database: ReviewIntentDatabase,
  options: ReviewIntentPortOptions,
): ReviewIntentPort {
  return {
    async claimNextReviewIntent(now: Date) {
      const row = await claimNextIntentRow(database, now);
      if (row === null) return null;

      const normalizedRow = normalizeClaimedReviewIntentRow(row);
      const pullRequest = await buildPullRequestReviewInput(database, normalizedRow, options);
      if (pullRequest === null) {
        await markReviewIntentProcessed(database, normalizedRow.id, now);
        return null;
      }

      return {
        id: normalizedRow.id,
        deliveryId: normalizedRow.deliveryId,
        kind: normalizedRow.kind,
        pullRequest,
        prState: normalizedRow.prState ?? undefined,
        createdAt: normalizedRow.createdAt,
        claimedAt: normalizedRow.claimedAt,
      };
    },
    markReviewIntentProcessed(intentId: string, now: Date) {
      return markReviewIntentProcessed(database, intentId, now);
    },
    markReviewIntentFailed(intentId: string) {
      return markReviewIntentFailed(database, intentId);
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
): Promise<PullRequestReviewInput | null> {
  const [target] = await database
    .select({
      userId: githubInstallation.userId,
      installationId: githubInstallation.installationId,
      owner: repository.owner,
      name: repository.name,
      headSha: reviewIntent.headSha,
      currentHeadSha: pullRequestState.headSha,
      dailyCostCapUsd: userReviewSettings.dailyCostCapUsd,
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
      eq(githubInstallation.installationId, githubInstallationRepository.installationId),
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

  if (!target?.userId) return null;

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
  if (!headSha || agents.length === 0) return null;

  return {
    userId: target.userId,
    repositoryId: intent.repositoryId,
    installationId: target.installationId,
    repository: { owner: target.owner, name: target.name },
    pullRequestNumber: intent.prNumber,
    headSha,
    trigger: toReviewTrigger(intent.kind),
    agents: agents.map(toAgentSpec),
    dailyCostCapUsd: Number(target.dailyCostCapUsd ?? options.defaultDailyCostCapUsd),
  };
}

function markReviewIntentProcessed(
  database: ReviewIntentDatabase,
  intentId: string,
  now: Date,
): Promise<void> {
  return database
    .update(reviewIntent)
    .set({ processedAt: now })
    .where(and(eq(reviewIntent.id, intentId), isNull(reviewIntent.processedAt)))
    .then(() => {});
}

function markReviewIntentFailed(database: ReviewIntentDatabase, intentId: string): Promise<void> {
  return database
    .update(reviewIntent)
    .set({ claimedAt: null })
    .where(and(eq(reviewIntent.id, intentId), isNull(reviewIntent.processedAt)))
    .then(() => {});
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
