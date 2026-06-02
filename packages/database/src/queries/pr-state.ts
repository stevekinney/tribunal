/**
 * Pull request state queries.
 *
 * All queries are scoped by repositoryId.
 */

import { and, eq } from '../operators';
import type { Database } from '../connection';
import { pullRequestState, type PullRequestState } from '../schema/pull-request-state';

/**
 * Get a single PR state by repository and PR number.
 */
export async function getPRState(
  database: Database,
  repositoryId: number,
  prNumber: number,
): Promise<PullRequestState | null> {
  const [row] = await database
    .select()
    .from(pullRequestState)
    .where(
      and(eq(pullRequestState.repositoryId, repositoryId), eq(pullRequestState.prNumber, prNumber)),
    )
    .limit(1);

  return row ?? null;
}
