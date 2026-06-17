import type { ActionItemStatus } from '@tribunal/database/schema';

type StatusTransitionInput = {
  completed: boolean;
  currentHeadSha: string | null;
  existingFirstSeenHeadSha: string | null;
};

/**
 * Compute the database status for an action item based on its completion
 * state and head SHA history.
 *
 * Transition rules:
 * - `done`: source condition resolved (thread resolved, CI passing, human-checked)
 * - `pending`: new item on current head SHA, or no SHA tracking available
 * - `in_progress`: unresolved item where current head SHA differs from first-seen SHA
 */
export function computeActionItemStatus(input: StatusTransitionInput): ActionItemStatus {
  if (input.completed) return 'done';
  if (!input.currentHeadSha) return 'pending';
  if (!input.existingFirstSeenHeadSha) return 'pending';
  if (input.existingFirstSeenHeadSha !== input.currentHeadSha) return 'in_progress';
  return 'pending';
}
