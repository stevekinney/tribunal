import type { ActionItemSourceType } from '@tribunal/database/schema';

/**
 * Map a stable key prefix to the corresponding action item source type.
 *
 * Stable key formats:
 * - `review-comment:{threadId}:{commentId}` → `review_comment`
 * - `review-thread-{nodeId}` → `review_comment` (legacy format; same semantic as review-comment)
 * - `issue-comment-{commentId}` → `issue_comment`
 * - `review-{reviewId}` → `review`
 * - `ci-check-{checkName}` → `ci_check_run`
 * - anything else → `composite`
 *
 * Note: `review-thread-` must be checked before `review-` so that legacy keys
 * are correctly classified as `review_comment` rather than `review`.
 */
export function extractSourceType(stableKey: string): ActionItemSourceType {
  if (stableKey.startsWith('review-comment:')) return 'review_comment';
  if (stableKey.startsWith('review-thread-')) return 'review_comment';
  if (stableKey.startsWith('issue-comment-')) return 'issue_comment';
  if (stableKey.startsWith('review-')) return 'review';
  if (stableKey.startsWith('ci-check-')) return 'ci_check_run';
  return 'composite';
}
