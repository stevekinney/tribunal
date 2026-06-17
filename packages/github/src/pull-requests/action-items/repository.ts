import { and, count, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Database } from '@tribunal/database';
import {
  pullRequestActionItem,
  pullRequestActionItemSource,
  pullRequestActionItemDependency,
} from '@tribunal/database/schema';
import type {
  PullRequestActionItem,
  PullRequestActionItemSource,
  ActionItemStatus,
} from '@tribunal/database/schema';
import type { ActionItemInput, ActionItemSourceInput } from './types.js';

// ============================================================================
// UPSERT
// ============================================================================

/**
 * Upsert action items for a pull request state. Uses the unique
 * `(pullRequestStateId, stableKey)` index for deduplication. On conflict,
 * updates subject, description, status, and explicitly sets updatedAt
 * (critical: `$onUpdate` does not fire on conflict updates).
 *
 * `firstSeenHeadSha` is backfilled on conflict using COALESCE so that rows
 * created before the column was added (where `first_seen_head_sha` is null)
 * receive the current head SHA on the next upsert. Once set, the value is
 * preserved — the COALESCE expression keeps the existing non-null value and
 * never overwrites it, maintaining the "first seen" semantics.
 */
export async function upsertActionItems(
  db: Database,
  pullRequestStateId: number,
  items: ActionItemInput[],
): Promise<PullRequestActionItem[]> {
  const results: PullRequestActionItem[] = [];

  for (const item of items) {
    const [result] = await db
      .insert(pullRequestActionItem)
      .values({
        pullRequestStateId,
        stableKey: item.stableKey,
        subject: item.subject,
        description: item.description ?? null,
        status: item.status,
        firstSeenHeadSha: item.firstSeenHeadSha ?? null,
      })
      .onConflictDoUpdate({
        target: [pullRequestActionItem.pullRequestStateId, pullRequestActionItem.stableKey],
        set: {
          subject: item.subject,
          description: item.description ?? null,
          status: item.status,
          updatedAt: new Date(),
          // Backfill null firstSeenHeadSha values from rows created before the
          // column was added. COALESCE preserves the existing non-null value so
          // the "first seen" semantics are maintained once the field is set.
          firstSeenHeadSha: sql`COALESCE(${pullRequestActionItem.firstSeenHeadSha}, ${item.firstSeenHeadSha ?? null})`,
        },
      })
      .returning();

    results.push(result);
  }

  return results;
}

// ============================================================================
// SOURCES
// ============================================================================

/**
 * Append sources to an action item. Uses `onConflictDoNothing` on the unique
 * `(actionItemId, sourceType, sourceIdentifier)` index — sources are append-only.
 */
export async function addActionItemSources(
  db: Database,
  actionItemId: number,
  sources: ActionItemSourceInput[],
): Promise<void> {
  for (const source of sources) {
    await db
      .insert(pullRequestActionItemSource)
      .values({
        actionItemId,
        sourceType: source.sourceType,
        sourceIdentifier: source.sourceIdentifier,
        sourceUrl: source.sourceUrl ?? null,
      })
      .onConflictDoNothing({
        target: [
          pullRequestActionItemSource.actionItemId,
          pullRequestActionItemSource.sourceType,
          pullRequestActionItemSource.sourceIdentifier,
        ],
      });
  }
}

// ============================================================================
// DEPENDENCIES
// ============================================================================

/**
 * Replace all dependencies for an action item. Wraps the delete-then-insert
 * in a transaction so a failed insert cannot leave the action item with no
 * dependencies. Self-dependency is rejected by the DB check constraint.
 */
export async function replaceActionItemDependencies(
  db: Database,
  actionItemId: number,
  dependsOnIds: number[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(pullRequestActionItemDependency)
      .where(eq(pullRequestActionItemDependency.actionItemId, actionItemId));

    if (dependsOnIds.length > 0) {
      await tx.insert(pullRequestActionItemDependency).values(
        dependsOnIds.map((dependsOnActionItemId) => ({
          actionItemId,
          dependsOnActionItemId,
        })),
      );
    }
  });
}

// ============================================================================
// QUERIES
// ============================================================================

/**
 * List action items for a pull request state with optional status filter
 * and cursor-based pagination.
 */
export async function listActionItems(
  db: Database,
  pullRequestStateId: number,
  filters?: { status?: ActionItemStatus },
  cursor?: number,
  limit = 50,
): Promise<PullRequestActionItem[]> {
  const conditions = [eq(pullRequestActionItem.pullRequestStateId, pullRequestStateId)];

  if (filters?.status) {
    conditions.push(eq(pullRequestActionItem.status, filters.status));
  }
  if (cursor) {
    conditions.push(gt(pullRequestActionItem.id, cursor));
  }

  return db
    .select()
    .from(pullRequestActionItem)
    .where(and(...conditions))
    .orderBy(pullRequestActionItem.id)
    .limit(limit);
}

/**
 * Count action items grouped by status for a pull request state.
 */
export async function countActionItemsByStatus(
  db: Database,
  pullRequestStateId: number,
): Promise<Record<ActionItemStatus, number>> {
  const rows = await db
    .select({
      status: pullRequestActionItem.status,
      count: count(),
    })
    .from(pullRequestActionItem)
    .where(eq(pullRequestActionItem.pullRequestStateId, pullRequestStateId))
    .groupBy(pullRequestActionItem.status);

  const result: Record<ActionItemStatus, number> = {
    pending: 0,
    in_progress: 0,
    done: 0,
  };

  for (const row of rows) {
    result[row.status] = row.count;
  }

  return result;
}

/**
 * Get a single action item by the unique `(pullRequestStateId, stableKey)` pair.
 */
export async function getActionItem(
  db: Database,
  pullRequestStateId: number,
  stableKey: string,
): Promise<PullRequestActionItem | null> {
  const [result] = await db
    .select()
    .from(pullRequestActionItem)
    .where(
      and(
        eq(pullRequestActionItem.pullRequestStateId, pullRequestStateId),
        eq(pullRequestActionItem.stableKey, stableKey),
      ),
    )
    .limit(1);

  return result ?? null;
}

// ============================================================================
// METADATA QUERIES
// ============================================================================

export type PullRequestActionItemDependencyRecord = {
  dependsOnActionItemId: number;
  dependsOnStableKey: string;
  dependsOnSubject: string;
};

export type PullRequestActionItemWithMetadata = PullRequestActionItem & {
  sources: PullRequestActionItemSource[];
  dependencies: PullRequestActionItemDependencyRecord[];
};

/**
 * List action items for a pull request state with sources and dependency targets.
 * Ordering is deterministic:
 * 1) Status rank: pending, in_progress, done
 * 2) createdAt ascending
 * 3) stableKey ascending
 */
export async function listActionItemsWithMetadata(
  db: Database,
  pullRequestStateId: number,
): Promise<PullRequestActionItemWithMetadata[]> {
  const items = await db
    .select()
    .from(pullRequestActionItem)
    .where(eq(pullRequestActionItem.pullRequestStateId, pullRequestStateId))
    .orderBy(
      sql`CASE
        WHEN ${pullRequestActionItem.status} = 'pending' THEN 0
        WHEN ${pullRequestActionItem.status} = 'in_progress' THEN 1
        ELSE 2
      END`,
      pullRequestActionItem.createdAt,
      pullRequestActionItem.stableKey,
    );

  if (items.length === 0) {
    return [];
  }

  const actionItemIds = items.map((item) => item.id);

  const sources = await db
    .select()
    .from(pullRequestActionItemSource)
    .where(inArray(pullRequestActionItemSource.actionItemId, actionItemIds))
    .orderBy(
      pullRequestActionItemSource.actionItemId,
      pullRequestActionItemSource.createdAt,
      pullRequestActionItemSource.sourceType,
      pullRequestActionItemSource.sourceIdentifier,
    );

  const dependencyLinks = await db
    .select({
      actionItemId: pullRequestActionItemDependency.actionItemId,
      dependsOnActionItemId: pullRequestActionItemDependency.dependsOnActionItemId,
    })
    .from(pullRequestActionItemDependency)
    .where(inArray(pullRequestActionItemDependency.actionItemId, actionItemIds))
    .orderBy(
      pullRequestActionItemDependency.actionItemId,
      pullRequestActionItemDependency.dependsOnActionItemId,
    );

  const dependencyTargetIds = Array.from(
    new Set(dependencyLinks.map((dependency) => dependency.dependsOnActionItemId)),
  );
  const dependencyTargets =
    dependencyTargetIds.length > 0
      ? await db
          .select({
            id: pullRequestActionItem.id,
            stableKey: pullRequestActionItem.stableKey,
            subject: pullRequestActionItem.subject,
            createdAt: pullRequestActionItem.createdAt,
          })
          .from(pullRequestActionItem)
          .where(inArray(pullRequestActionItem.id, dependencyTargetIds))
      : [];

  const dependencyTargetsById = new Map<number, (typeof dependencyTargets)[number]>();
  for (const target of dependencyTargets) {
    dependencyTargetsById.set(target.id, target);
  }

  const sourcesByActionItemId = new Map<number, PullRequestActionItemSource[]>();
  for (const source of sources) {
    const entries = sourcesByActionItemId.get(source.actionItemId) ?? [];
    entries.push(source);
    sourcesByActionItemId.set(source.actionItemId, entries);
  }

  const dependenciesByActionItemId = new Map<number, PullRequestActionItemDependencyRecord[]>();
  for (const dependency of dependencyLinks) {
    const target = dependencyTargetsById.get(dependency.dependsOnActionItemId);
    const entries = dependenciesByActionItemId.get(dependency.actionItemId) ?? [];
    entries.push({
      dependsOnActionItemId: dependency.dependsOnActionItemId,
      dependsOnStableKey: target?.stableKey ?? `action-item-${dependency.dependsOnActionItemId}`,
      dependsOnSubject: target?.subject ?? '',
    });
    dependenciesByActionItemId.set(dependency.actionItemId, entries);
  }

  // Keep dependency display order deterministic by target creation time then stable key.
  for (const [actionItemId, dependencies] of dependenciesByActionItemId.entries()) {
    dependencies.sort((left, right) => {
      const leftTarget = dependencyTargetsById.get(left.dependsOnActionItemId);
      const rightTarget = dependencyTargetsById.get(right.dependsOnActionItemId);

      const leftTimestamp = leftTarget?.createdAt.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTimestamp = rightTarget?.createdAt.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp;

      if (left.dependsOnStableKey < right.dependsOnStableKey) return -1;
      if (left.dependsOnStableKey > right.dependsOnStableKey) return 1;

      return left.dependsOnActionItemId - right.dependsOnActionItemId;
    });
    dependenciesByActionItemId.set(actionItemId, dependencies);
  }

  return items.map((item) => ({
    ...item,
    sources: sourcesByActionItemId.get(item.id) ?? [],
    dependencies: dependenciesByActionItemId.get(item.id) ?? [],
  }));
}
