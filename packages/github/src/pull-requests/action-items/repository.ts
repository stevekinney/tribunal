import { sql } from 'drizzle-orm';
import type { Database } from '@tribunal/database';
import { pullRequestActionItem, pullRequestActionItemSource } from '@tribunal/database/schema';
import type { PullRequestActionItem } from '@tribunal/database/schema';
import type { ActionItemInput, ActionItemSourceInput } from './types.js';

// ============================================================================
// UPSERT
// ============================================================================

/**
 * Upsert action items for a pull request state. Uses the unique
 * `(pullRequestStateId, stableKey)` index for deduplication.
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
  if (items.length === 0) {
    return [];
  }

  // Single multi-row upsert. With up to ~100 threads × ~50 comments, a per-item
  // loop is O(items) round trips; one statement is O(1). The conflict-update set
  // references the proposed row via `excluded.*` rather than per-item literals,
  // and COALESCE keeps an already-set firstSeenHeadSha (preserving "first seen").
  return db
    .insert(pullRequestActionItem)
    .values(
      items.map((item) => ({
        pullRequestStateId,
        stableKey: item.stableKey,
        firstSeenHeadSha: item.firstSeenHeadSha ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [pullRequestActionItem.pullRequestStateId, pullRequestActionItem.stableKey],
      set: {
        firstSeenHeadSha: sql`COALESCE(${pullRequestActionItem.firstSeenHeadSha}, excluded.first_seen_head_sha)`,
      },
    })
    .returning();
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
  if (sources.length === 0) {
    return;
  }

  // Single multi-row insert (one round trip), append-only via onConflictDoNothing.
  await db
    .insert(pullRequestActionItemSource)
    .values(
      sources.map((source) => ({
        actionItemId,
        sourceType: source.sourceType,
        sourceIdentifier: source.sourceIdentifier,
      })),
    )
    .onConflictDoNothing({
      target: [
        pullRequestActionItemSource.actionItemId,
        pullRequestActionItemSource.sourceType,
        pullRequestActionItemSource.sourceIdentifier,
      ],
    });
}
