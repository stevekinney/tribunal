/**
 * Handle push events on the default branch to update behind/mergeable status
 * for all open PRs targeting that branch.
 */

import { and, eq } from 'drizzle-orm';
import type { GithubServiceContext } from '../../context.js';
import { pullRequestState } from '@tribunal/database/schema';
import type { Octokit } from 'octokit';
import { mapMergeableState } from './queries.js';

interface BaseBranchPushContext {
  repositoryId: number;
  ref: string;
  defaultBranch: string;
}

/**
 * Update merge status for all open PRs targeting the pushed branch.
 * Called when a push event arrives for the repository's default branch.
 */
export async function handleBaseBranchPush(
  context: GithubServiceContext,
  ctx: BaseBranchPushContext,
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ updated: number; errors: number; affectedPrNumbers: number[] }> {
  const branchName = ctx.ref.replace('refs/heads/', '');

  if (branchName !== ctx.defaultBranch) {
    return { updated: 0, errors: 0, affectedPrNumbers: [] };
  }

  const openPrs = await context.db
    .select({
      id: pullRequestState.id,
      prNumber: pullRequestState.prNumber,
      headSha: pullRequestState.headSha,
    })
    .from(pullRequestState)
    .where(
      and(
        eq(pullRequestState.repositoryId, ctx.repositoryId),
        eq(pullRequestState.baseRef, branchName),
        eq(pullRequestState.state, 'open'),
        eq(pullRequestState.isMerged, false),
      ),
    );

  if (openPrs.length === 0) {
    return { updated: 0, errors: 0, affectedPrNumbers: [] };
  }

  let updated = 0;
  let errors = 0;

  for (const pr of openPrs) {
    try {
      const { data: prData } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pr.prNumber,
      });

      const mergeStatus = mapMergeableState(prData.mergeable_state);

      await context.db
        .update(pullRequestState)
        .set({
          mergeStatus,
          baseSha: prData.base.sha,
          mergeUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(pullRequestState.id, pr.id));

      updated++;
    } catch (error) {
      console.error(`[base-branch-update] Failed to update PR #${pr.prNumber}:`, error);
      errors++;
    }
  }

  const affectedPrNumbers = openPrs.map((pr) => pr.prNumber);

  console.log(
    `[base-branch-update] Updated ${updated} PRs, ${errors} errors for ${owner}/${repo}:${branchName}`,
  );
  return { updated, errors, affectedPrNumbers };
}
