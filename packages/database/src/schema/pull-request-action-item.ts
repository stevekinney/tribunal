import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actionItemSourceTypeEnum, actionItemStatusEnum } from './enums';
import { pullRequestState } from './pull-request-state';

// ============================================================================
// TABLES
// ============================================================================

/**
 * A single actionable item derived from a pull request's conversation.
 *
 * Items are keyed by a stable, source-derived `stableKey` (e.g.
 * `review-comment:{threadId}:{commentId}`, `ci-check-{name}`) so repeated
 * analysis cycles reconcile against the same row instead of creating duplicates.
 * `firstSeenHeadSha` is set once and never overwritten so "done since first
 * seen" can be computed; status is derived (thread resolved / check passing /
 * human checkbox) and persisted here for fast read-model queries.
 */
export const pullRequestActionItem = pgTable(
  'pull_request_action_item',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    pullRequestStateId: integer('pull_request_state_id')
      .notNull()
      .references(() => pullRequestState.id, { onDelete: 'cascade' }),
    stableKey: text('stable_key').notNull(),
    subject: text('subject').notNull(),
    description: text('description'),
    status: actionItemStatusEnum('status').notNull().default('pending'),
    firstSeenHeadSha: text('first_seen_head_sha'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Reconciliation key: one item per (PR state, stable key).
    uniqueIndex('pull_request_action_item_state_key_idx').on(
      table.pullRequestStateId,
      table.stableKey,
    ),
    index('pull_request_action_item_status_idx').on(table.status),
  ],
);

/**
 * The concrete sources an action item was derived from (a comment, a check,
 * etc.). One item can aggregate multiple sources; each source is deduplicated
 * on `(actionItemId, sourceType, sourceIdentifier)`.
 */
export const pullRequestActionItemSource = pgTable(
  'pull_request_action_item_source',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    actionItemId: integer('action_item_id')
      .notNull()
      .references(() => pullRequestActionItem.id, { onDelete: 'cascade' }),
    sourceType: actionItemSourceTypeEnum('source_type').notNull(),
    sourceIdentifier: text('source_identifier').notNull(),
    sourceUrl: text('source_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The composite unique index leads with actionItemId, so it also satisfies
    // single-column lookups by actionItemId — no separate index needed.
    uniqueIndex('pull_request_action_item_source_dedup_idx').on(
      table.actionItemId,
      table.sourceType,
      table.sourceIdentifier,
    ),
  ],
);

/**
 * Directed dependency edges between action items (item A blocks item B).
 * A self-reference is rejected by a check constraint; the reverse index
 * supports "what depends on this item" lookups.
 */
export const pullRequestActionItemDependency = pgTable(
  'pull_request_action_item_dependency',
  {
    actionItemId: integer('action_item_id')
      .notNull()
      .references(() => pullRequestActionItem.id, { onDelete: 'cascade' }),
    dependsOnActionItemId: integer('depends_on_action_item_id')
      .notNull()
      .references(() => pullRequestActionItem.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.actionItemId, table.dependsOnActionItemId] }),
    check(
      'pull_request_action_item_dependency_no_self_ref',
      sql`${table.actionItemId} != ${table.dependsOnActionItemId}`,
    ),
    index('pull_request_action_item_dependency_reverse_idx').on(table.dependsOnActionItemId),
  ],
);

// ============================================================================
// TYPES
// ============================================================================

export type PullRequestActionItem = typeof pullRequestActionItem.$inferSelect;
export type NewPullRequestActionItem = typeof pullRequestActionItem.$inferInsert;
export type PullRequestActionItemSource = typeof pullRequestActionItemSource.$inferSelect;
export type NewPullRequestActionItemSource = typeof pullRequestActionItemSource.$inferInsert;
export type PullRequestActionItemDependency = typeof pullRequestActionItemDependency.$inferSelect;
export type NewPullRequestActionItemDependency =
  typeof pullRequestActionItemDependency.$inferInsert;
