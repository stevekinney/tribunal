/**
 * PR description action items — parsing, rendering, and reconciliation.
 *
 * Pure functions for managing an action items checklist block in PR descriptions.
 * The block is delimited by HTML comment markers and each item carries a stable ID
 * as a trailing HTML comment for identity across reconcile cycles.
 *
 * Format:
 * ```markdown
 * <!--TRIBUNAL-ACTION-ITEMS-START-->
 * ## Action Items
 *
 * - [ ] Address review feedback: "Add null check" — [source](url) <!-- tribunal:ai:review-thread-RT_abc123 -->
 * - [x] ~~Fix CI: lint check~~ — [source](url) <!-- tribunal:ai:ci-check-lint -->
 * <!--TRIBUNAL-ACTION-ITEMS-END-->
 * ```
 */

import { sanitizeActionItemCandidate } from './sanitization.js';
import { deterministicSummary } from './summarize.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const BLOCK_START = '<!--TRIBUNAL-ACTION-ITEMS-START-->';
const BLOCK_END = '<!--TRIBUNAL-ACTION-ITEMS-END-->';
const BLOCK_HEADING = '## Action Items';

/** Regex to extract a stable ID from a trailing HTML comment: <!-- tribunal:ai:{id} --> */
const STABLE_ID_REGEX = /<!--\s*tribunal:ai:(.+?)\s*-->$/;

/** Regex to parse a checklist item: "- [x] text" or "- [ ] text" */
const CHECKLIST_ITEM_REGEX = /^-\s*\[([ xX])\]\s+(.+)$/;

// ============================================================================
// TYPES
// ============================================================================

export type ParsedActionItem = {
  id: string;
  description: string;
  completed: boolean;
  sourceUrl?: string;
  rawLine: string;
};

export type DerivedActionItem = {
  id: string;
  description: string;
  completed: boolean;
  sourceRef?: string;
};

export type ActionItem = {
  id: string;
  description: string;
  completed: boolean;
  sourceUrl?: string;
};

export type ParsedBlock = {
  items: ParsedActionItem[];
  /** Start index of the block in the body string (inclusive). */
  startIndex: number;
  /** End index of the block in the body string (exclusive). */
  endIndex: number;
};

export type ConversationState = {
  resolvedThreadIds: Set<string>;
  allChecksPassing: boolean;
  passingCheckNames: Set<string>;
};

// ============================================================================
// PARSING
// ============================================================================

/**
 * Parse the action items block from a PR description.
 * Returns null if no block markers are found.
 */
export function parseActionItemsBlock(body: string): ParsedBlock | null {
  const startIdx = body.indexOf(BLOCK_START);
  if (startIdx === -1) return null;

  const endIdx = body.indexOf(BLOCK_END, startIdx);
  if (endIdx === -1) return null;

  const blockContent = body.slice(startIdx + BLOCK_START.length, endIdx);
  const lines = blockContent.split('\n');
  const items: ParsedActionItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === BLOCK_HEADING) continue;

    // Strip trailing stable ID comment to get the checklist content
    let itemLine = trimmed;
    let stableId = '';

    const idMatch = STABLE_ID_REGEX.exec(trimmed);
    if (idMatch) {
      stableId = idMatch[1];
      itemLine = trimmed.slice(0, idMatch.index).trim();
    }

    // Parse the checklist item
    const checkMatch = CHECKLIST_ITEM_REGEX.exec(itemLine);
    if (!checkMatch) continue;

    // Skip checklist lines with no `tribunal:ai:` stable-id comment. Carrying
    // them with id:'' would (a) collapse multiple unmarked lines onto the same
    // empty stableKey and collide on the unique (pullRequestStateId, stableKey)
    // index, and (b) match no auto-completion rule.
    //
    // Note: the whole TRIBUNAL-ACTION-ITEMS block is workflow-owned —
    // `updatePRDescription` replaces it wholesale on each cycle — so a line a
    // human hand-adds *inside* the block (without our marker) is NOT preserved;
    // it is dropped on the next render. Humans should edit checkbox state of
    // marked items or add notes OUTSIDE the block. (This is the intended
    // ownership contract; preserving in-block unowned lines is a future option.)
    if (!stableId) continue;

    const completed = checkMatch[1].toLowerCase() === 'x';
    let description = checkMatch[2].trim();

    // Extract source URL from markdown link: — [source](url)
    let sourceUrl: string | undefined;
    const sourceLinkMatch = /\s*—\s*\[source\]\((.+?)\)\s*$/.exec(description);
    if (sourceLinkMatch) {
      sourceUrl = sourceLinkMatch[1];
      description = description.slice(0, sourceLinkMatch.index).trim();
    }

    // Strip strikethrough markers for completed items
    if (completed && description.startsWith('~~') && description.endsWith('~~')) {
      description = description.slice(2, -2);
    }

    items.push({
      id: stableId,
      description,
      completed,
      sourceUrl,
      rawLine: trimmed,
    });
  }

  return {
    items,
    startIndex: startIdx,
    endIndex: endIdx + BLOCK_END.length,
  };
}

// ============================================================================
// RENDERING
// ============================================================================

/**
 * Render action items into the block format.
 *
 * Filters out items with empty descriptions to prevent blank checklist bullets.
 */
export function renderActionItemsBlock(items: ActionItem[]): string {
  const validItems = items.filter((item) => item.description.trim().length > 0);

  if (validItems.length === 0) {
    return [BLOCK_START, BLOCK_HEADING, '', '_No action items yet._', '', BLOCK_END].join('\n');
  }

  const lines = [BLOCK_START, BLOCK_HEADING, ''];

  for (const item of validItems) {
    const checkbox = item.completed ? '[x]' : '[ ]';
    let text = item.description;

    // Apply strikethrough for completed items
    if (item.completed) {
      text = `~~${text}~~`;
    }

    // Add source link if available
    if (item.sourceUrl) {
      text += ` — [source](${item.sourceUrl})`;
    }

    // Add stable ID as trailing HTML comment using the Tribunal namespace
    const idComment = `<!-- tribunal:ai:${item.id} -->`;
    lines.push(`- ${checkbox} ${text} ${idComment}`);
  }

  lines.push('', BLOCK_END);
  return lines.join('\n');
}

// ============================================================================
// RECONCILIATION
// ============================================================================

/**
 * Reconcile summarized-derived items with existing parsed items.
 *
 * Rules:
 * - Match by stable ID
 * - Preserve human checkbox edits (existing checkbox state wins on ID match)
 * - Add new items from derived list
 * - Never delete items (keep even if source is deleted)
 * - Auto-complete review thread items when thread is resolved
 * - Auto-complete CI items when checks pass
 */
export function reconcileActionItems(
  existing: ParsedActionItem[],
  derived: DerivedActionItem[],
  conversationState: ConversationState,
): ActionItem[] {
  // Healing pass: sanitize existing items and fix quality issues.
  // Only filter items matching hard patterns (vc payloads, opaque blobs, bot noise).
  // Short items and CI status updates are preserved for existing items to honor
  // the never-delete contract for human-edited checklist content.
  const healedExisting: ParsedActionItem[] = [];
  for (const item of existing) {
    const sanitization = sanitizeActionItemCandidate(item.description, item.id);

    if (
      sanitization.filtered &&
      sanitization.reason !== 'too_short' &&
      sanitization.reason !== 'ci_status_update'
    ) {
      // Clearly malformed item (vc payload, opaque blob, bot noise): remove
      continue;
    }

    // Use the normalized text returned by the sanitizer. For soft-filtered
    // items (too_short, ci_status_update) the sanitizer returns normalized
    // text rather than an empty string, so this expression is always the
    // whitespace-cleaned form. The fallback to item.description is retained
    // as a defensive guard against unexpected empty results.
    const baseDescription = sanitization.sanitized || item.description;

    // Check for quality issues (too long, apply deterministic summary)
    if (baseDescription.length > 200) {
      const healedDescription = deterministicSummary(baseDescription);
      healedExisting.push({ ...item, description: healedDescription });
    } else {
      healedExisting.push({ ...item, description: baseDescription });
    }
  }

  const existingById = new Map(healedExisting.map((item) => [item.id, item]));
  const result: ActionItem[] = [];
  const processedIds = new Set<string>();

  // Process derived items: merge with existing or add new
  for (const item of derived) {
    processedIds.add(item.id);

    const existingItem = existingById.get(item.id);
    if (existingItem) {
      // Existing item: preserve human checkbox state, use existing description
      result.push({
        id: item.id,
        description: existingItem.description,
        completed: resolveCompletionState(existingItem, item, conversationState),
        sourceUrl: item.sourceRef ?? existingItem.sourceUrl,
      });
    } else {
      // New item from derivation
      result.push({
        id: item.id,
        description: item.description,
        completed: resolveNewItemCompletion(item, conversationState),
        sourceUrl: item.sourceRef,
      });
    }
  }

  // Keep healed existing items that derivation didn't produce (never delete valid items).
  // Still apply auto-completion rules so orphaned items complete when
  // their thread is resolved or their CI check passes.
  for (const item of healedExisting) {
    if (!processedIds.has(item.id)) {
      result.push({
        id: item.id,
        description: item.description,
        completed: resolveOrphanedItemCompletion(item, conversationState),
        sourceUrl: item.sourceUrl,
      });
    }
  }

  return result;
}

/**
 * Resolve completion state for an existing item.
 *
 * Priority:
 * 1. If human manually checked/unchecked, preserve their state
 * 2. Auto-complete review thread items when resolved
 * 3. Auto-complete CI items when checks pass
 */
/**
 * Auto-completion rule shared by every completion resolver: returns `true` when
 * a stable id should be auto-marked done by conversation state (its review
 * thread is resolved, or its CI check is passing), or `null` when no rule
 * applies and the caller should fall back to its own signal. Keeping this in one
 * place means the thread/CI prefixes and the `ci-check-` lookup live in exactly
 * one spot.
 */
function autoCompleteByConversation(id: string, state: ConversationState): true | null {
  if (
    (id.startsWith('review-thread-') || id.startsWith('review-comment:')) &&
    isThreadResolved(id, state)
  ) {
    return true;
  }

  if (id.startsWith('ci-check-')) {
    if (state.allChecksPassing) return true;
    if (state.passingCheckNames.has(id.slice('ci-check-'.length))) return true;
  }

  return null;
}

/**
 * Completion state when an existing (parsed) item is reconciled against a freshly
 * derived one. A human checkbox always wins; otherwise auto-completion applies;
 * otherwise the derived suggestion (which factors in conversation state) wins.
 */
function resolveCompletionState(
  existing: ParsedActionItem,
  derived: DerivedActionItem,
  state: ConversationState,
): boolean {
  if (existing.completed) return true;
  return autoCompleteByConversation(existing.id, state) ?? derived.completed;
}

/** Completion state for a newly derived item (no existing human edit to honour). */
function resolveNewItemCompletion(item: DerivedActionItem, state: ConversationState): boolean {
  return autoCompleteByConversation(item.id, state) ?? item.completed;
}

/**
 * Completion state for an orphaned item (exists in PR body but no longer
 * produced by derivation). Preserves a human checkbox edit, still applies
 * auto-completion for resolved threads and passing CI checks.
 */
function resolveOrphanedItemCompletion(item: ParsedActionItem, state: ConversationState): boolean {
  if (item.completed) return true;
  return autoCompleteByConversation(item.id, state) ?? item.completed;
}

/**
 * Check if a review thread is resolved based on its stable ID.
 *
 * Supports two formats:
 * - Legacy: review-thread-{nodeId}[-{index}]
 * - Current: review-comment:{threadId}:{commentId}
 */
function isThreadResolved(stableId: string, state: ConversationState): boolean {
  if (stableId.startsWith('review-thread-')) {
    // Legacy format: review-thread-RT_abc123 or review-thread-RT_abc123-0
    const withoutPrefix = stableId.replace('review-thread-', '');
    // Remove any trailing index suffix (-0, -1, etc.)
    const nodeId = withoutPrefix.replace(/-\d+$/, '');
    return state.resolvedThreadIds.has(nodeId);
  }

  if (stableId.startsWith('review-comment:')) {
    // Current format: review-comment:{threadId}:{commentId}
    const parts = stableId.slice('review-comment:'.length).split(':');
    const threadId = parts[0];
    return state.resolvedThreadIds.has(threadId);
  }

  return false;
}

// ============================================================================
// DESCRIPTION UPDATE
// ============================================================================

/**
 * Insert or replace the action items block in a PR description.
 * Returns the updated body, or the original body if nothing changed.
 */
export function updatePRDescription(body: string, items: ActionItem[]): string {
  const block = renderActionItemsBlock(items);
  const parsed = parseActionItemsBlock(body);

  if (parsed) {
    // Replace existing block
    return body.slice(0, parsed.startIndex) + block + body.slice(parsed.endIndex);
  }

  // Append new block at the bottom
  const separator = body.endsWith('\n') ? '\n' : '\n\n';
  return body + separator + block;
}
