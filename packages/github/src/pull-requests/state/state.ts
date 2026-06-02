import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { GithubServiceContext } from '../../context.js';
import { pullRequestState } from '@tribunal/database/schema';
import type {
  PullRequestState,
  PullRequestStateInsert,
  AutomationStatus,
  CIStatus,
} from '@tribunal/database/schema';
import { getPRState as getPRStateFromDb } from '@tribunal/database/queries';

// ============================================================================
// TYPES
// ============================================================================

export interface PRStateFilters {
  automationStatus?: AutomationStatus;
  ciStatus?: CIStatus;
  isPaused?: boolean;
}

// ============================================================================
// UPSERT
// ============================================================================

/**
 * Insert or update PR state. Uses timestamp-based ordering to reject stale updates:
 * only updates a section (CI, review, PR metadata) if the event timestamp is newer
 * than the stored `*UpdatedAt` for that section.
 */
export async function upsertPRState(
  context: GithubServiceContext,
  data: PullRequestStateInsert,
): Promise<PullRequestState> {
  const [result] = await context.db
    .insert(pullRequestState)
    .values(data)
    .onConflictDoUpdate({
      target: [pullRequestState.repositoryId, pullRequestState.prNumber],
      set: {
        // PR metadata — update if prUpdatedAt is newer or not set
        state: data.prUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.prUpdatedAt} IS NULL OR ${pullRequestState.prUpdatedAt} < ${data.prUpdatedAt} THEN ${data.state ?? sql`${pullRequestState.state}`} ELSE ${pullRequestState.state} END`
          : data.state !== undefined
            ? sql`${data.state}`
            : pullRequestState.state,
        isDraft: data.prUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.prUpdatedAt} IS NULL OR ${pullRequestState.prUpdatedAt} < ${data.prUpdatedAt} THEN ${data.isDraft ?? sql`${pullRequestState.isDraft}`} ELSE ${pullRequestState.isDraft} END`
          : data.isDraft !== undefined
            ? sql`${data.isDraft}`
            : pullRequestState.isDraft,
        isMerged: data.prUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.prUpdatedAt} IS NULL OR ${pullRequestState.prUpdatedAt} < ${data.prUpdatedAt} THEN ${data.isMerged ?? sql`${pullRequestState.isMerged}`} ELSE ${pullRequestState.isMerged} END`
          : data.isMerged !== undefined
            ? sql`${data.isMerged}`
            : pullRequestState.isMerged,
        headSha: data.prUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.prUpdatedAt} IS NULL OR ${pullRequestState.prUpdatedAt} < ${data.prUpdatedAt} THEN ${data.headSha ?? sql`${pullRequestState.headSha}`} ELSE ${pullRequestState.headSha} END`
          : data.headSha !== undefined
            ? sql`${data.headSha}`
            : pullRequestState.headSha,
        baseSha: data.prUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.prUpdatedAt} IS NULL OR ${pullRequestState.prUpdatedAt} < ${data.prUpdatedAt} THEN ${data.baseSha ?? sql`${pullRequestState.baseSha}`} ELSE ${pullRequestState.baseSha} END`
          : data.baseSha !== undefined
            ? sql`${data.baseSha}`
            : pullRequestState.baseSha,
        baseRef: data.prUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.prUpdatedAt} IS NULL OR ${pullRequestState.prUpdatedAt} < ${data.prUpdatedAt} THEN ${data.baseRef ?? sql`${pullRequestState.baseRef}`} ELSE ${pullRequestState.baseRef} END`
          : data.baseRef !== undefined
            ? sql`${data.baseRef}`
            : pullRequestState.baseRef,
        prUpdatedAt: data.prUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.prUpdatedAt} IS NULL OR ${pullRequestState.prUpdatedAt} < ${data.prUpdatedAt} THEN ${data.prUpdatedAt} ELSE ${pullRequestState.prUpdatedAt} END`
          : pullRequestState.prUpdatedAt,

        // Merge status — update if mergeUpdatedAt is newer
        mergeStatus: data.mergeUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.mergeUpdatedAt} IS NULL OR ${pullRequestState.mergeUpdatedAt} < ${data.mergeUpdatedAt} THEN ${data.mergeStatus ?? sql`${pullRequestState.mergeStatus}`} ELSE ${pullRequestState.mergeStatus} END`
          : data.mergeStatus !== undefined
            ? sql`${data.mergeStatus}`
            : pullRequestState.mergeStatus,
        mergeUpdatedAt: data.mergeUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.mergeUpdatedAt} IS NULL OR ${pullRequestState.mergeUpdatedAt} < ${data.mergeUpdatedAt} THEN ${data.mergeUpdatedAt} ELSE ${pullRequestState.mergeUpdatedAt} END`
          : pullRequestState.mergeUpdatedAt,

        // CI — update if ciUpdatedAt is newer
        ciStatus: data.ciUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.ciUpdatedAt} IS NULL OR ${pullRequestState.ciUpdatedAt} < ${data.ciUpdatedAt} THEN ${data.ciStatus ?? sql`${pullRequestState.ciStatus}`} ELSE ${pullRequestState.ciStatus} END`
          : data.ciStatus !== undefined
            ? sql`${data.ciStatus}`
            : pullRequestState.ciStatus,
        failingCheckCount: data.ciUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.ciUpdatedAt} IS NULL OR ${pullRequestState.ciUpdatedAt} < ${data.ciUpdatedAt} THEN ${data.failingCheckCount ?? 0} ELSE ${pullRequestState.failingCheckCount} END`
          : data.failingCheckCount !== undefined
            ? sql`${data.failingCheckCount}`
            : pullRequestState.failingCheckCount,
        ciUpdatedAt: data.ciUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.ciUpdatedAt} IS NULL OR ${pullRequestState.ciUpdatedAt} < ${data.ciUpdatedAt} THEN ${data.ciUpdatedAt} ELSE ${pullRequestState.ciUpdatedAt} END`
          : pullRequestState.ciUpdatedAt,

        // Reviews — update if reviewUpdatedAt is newer
        reviewStatus: data.reviewUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.reviewUpdatedAt} IS NULL OR ${pullRequestState.reviewUpdatedAt} < ${data.reviewUpdatedAt} THEN ${data.reviewStatus ?? sql`${pullRequestState.reviewStatus}`} ELSE ${pullRequestState.reviewStatus} END`
          : data.reviewStatus !== undefined
            ? sql`${data.reviewStatus}`
            : pullRequestState.reviewStatus,
        approvalCount: data.reviewUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.reviewUpdatedAt} IS NULL OR ${pullRequestState.reviewUpdatedAt} < ${data.reviewUpdatedAt} THEN ${data.approvalCount ?? 0} ELSE ${pullRequestState.approvalCount} END`
          : data.approvalCount !== undefined
            ? sql`${data.approvalCount}`
            : pullRequestState.approvalCount,
        changesRequestedCount: data.reviewUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.reviewUpdatedAt} IS NULL OR ${pullRequestState.reviewUpdatedAt} < ${data.reviewUpdatedAt} THEN ${data.changesRequestedCount ?? 0} ELSE ${pullRequestState.changesRequestedCount} END`
          : data.changesRequestedCount !== undefined
            ? sql`${data.changesRequestedCount}`
            : pullRequestState.changesRequestedCount,
        unresolvedThreadCount: data.reviewUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.reviewUpdatedAt} IS NULL OR ${pullRequestState.reviewUpdatedAt} < ${data.reviewUpdatedAt} THEN ${data.unresolvedThreadCount ?? 0} ELSE ${pullRequestState.unresolvedThreadCount} END`
          : data.unresolvedThreadCount !== undefined
            ? sql`${data.unresolvedThreadCount}`
            : pullRequestState.unresolvedThreadCount,
        reviewUpdatedAt: data.reviewUpdatedAt
          ? sql`CASE WHEN ${pullRequestState.reviewUpdatedAt} IS NULL OR ${pullRequestState.reviewUpdatedAt} < ${data.reviewUpdatedAt} THEN ${data.reviewUpdatedAt} ELSE ${pullRequestState.reviewUpdatedAt} END`
          : pullRequestState.reviewUpdatedAt,

        // Always update updatedAt
        updatedAt: new Date(),
      },
    })
    .returning();

  return result;
}

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get a single PR state by repository and PR number.
 * Delegates to the canonical implementation in @tribunal/database/queries.
 */
export async function getPRState(
  context: GithubServiceContext,
  repositoryId: number,
  prNumber: number,
): Promise<PullRequestState | null> {
  return getPRStateFromDb(context.db, repositoryId, prNumber);
}

export async function listPRStates(
  context: GithubServiceContext,
  repositoryId: number,
  filters?: PRStateFilters,
  limit = 50,
  cursor?: number,
): Promise<PullRequestState[]> {
  const conditions = [eq(pullRequestState.repositoryId, repositoryId)];

  if (filters?.automationStatus) {
    conditions.push(eq(pullRequestState.automationStatus, filters.automationStatus));
  }
  if (filters?.ciStatus) {
    conditions.push(eq(pullRequestState.ciStatus, filters.ciStatus));
  }
  if (filters?.isPaused !== undefined) {
    conditions.push(eq(pullRequestState.isPaused, filters.isPaused));
  }
  if (cursor) {
    conditions.push(gt(pullRequestState.id, cursor));
  }

  return context.db
    .select()
    .from(pullRequestState)
    .where(and(...conditions))
    .limit(limit)
    .orderBy(pullRequestState.id);
}

export async function listPRStatesForRepositories(
  context: GithubServiceContext,
  prs: Array<{ repositoryId: number; prNumber: number }>,
): Promise<Map<string, PullRequestState>> {
  if (prs.length === 0) return new Map();

  // Build a set of composite keys for post-fetch filtering.
  // Drizzle does not expose a portable multi-column IN clause, so we use
  // inArray on both repositoryId and prNumber (a conjunctive filter that
  // dramatically reduces the result set at the DB level) and then filter
  // client-side on the exact (repositoryId, prNumber) pairs. The client-side
  // filter is cheap because the page size is bounded (~100 PRs max).
  const repositoryIds = [...new Set(prs.map((p) => p.repositoryId))];
  const prNumbers = [...new Set(prs.map((p) => p.prNumber))];
  const prKeySet = new Set(prs.map((p) => `${p.repositoryId}:${p.prNumber}`));

  const rows = await context.db
    .select()
    .from(pullRequestState)
    .where(
      and(
        inArray(pullRequestState.repositoryId, repositoryIds),
        inArray(pullRequestState.prNumber, prNumbers),
      ),
    );

  const map = new Map<string, PullRequestState>();
  for (const row of rows) {
    const key = `${row.repositoryId}:${row.prNumber}`;
    if (prKeySet.has(key)) {
      map.set(key, row);
    }
  }
  return map;
}

// ============================================================================
// MUTATIONS
// ============================================================================

export async function setIsPaused(
  context: GithubServiceContext,
  repositoryId: number,
  prNumber: number,
  isPaused: boolean,
): Promise<PullRequestState | null> {
  const [result] = await context.db
    .update(pullRequestState)
    .set({ isPaused, updatedAt: new Date() })
    .where(
      and(eq(pullRequestState.repositoryId, repositoryId), eq(pullRequestState.prNumber, prNumber)),
    )
    .returning();

  return result ?? null;
}
