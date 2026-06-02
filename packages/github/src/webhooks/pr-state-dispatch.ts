/**
 * Fire-and-forget PR state tracking dispatch.
 *
 * These functions dispatch PR state updates without blocking the webhook response.
 * Failures are logged but never cause the webhook to fail.
 */

import type { GithubServiceContext } from '../context.js';
import {
  handlePullRequestStateUpdate,
  handleReviewStateUpdate,
  handleCheckSuiteCompleted,
  handleBaseBranchPush,
} from '../pull-requests/state/index.js';
import { getRepositoryById, updateRepositoryCommit } from '../repositories/service.js';
import {
  isPullRequestOpenedEvent,
  isPullRequestClosedEvent,
  isPullRequestReopenedEvent,
  isPullRequestSynchronizeEvent,
  isPullRequestConvertedToDraftEvent,
  isPullRequestReadyForReviewEvent,
  isPullRequestReviewSubmittedEvent,
  isPullRequestReviewDismissedEvent,
  isCheckSuiteCompletedEvent,
} from './validate-github-webhook.js';
import type { PushEvent } from './validate-github-webhook.js';
import type { WebhookPayload } from './types.js';

/**
 * Dispatch PR state tracking updates (fire-and-forget).
 * Failures are logged but never block the webhook response.
 */
export function dispatchPRStateTracking(
  context: GithubServiceContext,
  eventType: string | null,
  action: string | null,
  data: WebhookPayload,
): void {
  // pull_request state updates: the library has no generic isPullRequestEvent, so
  // narrow with the per-action guards that correspond to the tracked PR_ACTIONS.
  if (
    isPullRequestOpenedEvent(data) ||
    isPullRequestClosedEvent(data) ||
    isPullRequestReopenedEvent(data) ||
    isPullRequestSynchronizeEvent(data) ||
    isPullRequestConvertedToDraftEvent(data) ||
    isPullRequestReadyForReviewEvent(data)
  ) {
    void handlePullRequestStateUpdate(context, data, data.action).catch((e) =>
      console.error('PR state: pull_request handler failed:', e),
    );
  }

  if (isPullRequestReviewSubmittedEvent(data) || isPullRequestReviewDismissedEvent(data)) {
    const installationId = data.installation?.id;
    if (installationId) {
      void context
        .getInstallationOctokit(installationId)
        .then((octokit) => {
          if (octokit) {
            return handleReviewStateUpdate(context, data, octokit);
          }
        })
        .catch((e) => console.error('PR state: review handler failed:', e));
    }
  }

  if (isCheckSuiteCompletedEvent(data)) {
    const installationId = data.installation?.id;
    if (installationId) {
      void context
        .getInstallationOctokit(installationId)
        .then((octokit) => {
          if (octokit) {
            return handleCheckSuiteCompleted(context, data, octokit);
          }
        })
        .catch((e) => console.error('PR state: check_suite handler failed:', e));
    }
  }
}

/**
 * Dispatch base branch update for push events (fire-and-forget).
 */
export async function dispatchBaseBranchUpdate(
  context: GithubServiceContext,
  data: PushEvent,
): Promise<void> {
  const repositoryRecord = await getRepositoryById(context, data.repository.id);
  if (!repositoryRecord?.defaultBranch) return;

  const installation = data.installation as { id: number } | undefined;
  if (!installation) return;

  const branchName = data.ref.replace('refs/heads/', '');

  // If this is a push to the default branch, update the stored commit SHA
  if (branchName === repositoryRecord.defaultBranch && data.after) {
    try {
      await updateRepositoryCommit(context, data.repository.id, data.after);
      console.log(
        `[base-branch-update] Updated repository commit: ${data.repository.full_name} → ${data.after.substring(0, 7)}`,
      );
    } catch (e) {
      console.error('[base-branch-update] Failed to update repository commit:', e);
    }
  }

  const octokit = await context.getInstallationOctokit(installation.id);
  if (!octokit) return;

  const result = await handleBaseBranchPush(
    context,
    {
      repositoryId: data.repository.id,
      ref: data.ref,
      defaultBranch: repositoryRecord.defaultBranch,
    },
    octokit,
    data.repository.owner.login ?? data.repository.owner.name,
    data.repository.name,
  );

  // Active orchestrators for affected PRs would have been signaled here.
  if (result.affectedPrNumbers.length > 0) {
    console.log('[base-branch-update] would signal orchestrators', {
      repositoryId: data.repository.id,
      prNumbers: result.affectedPrNumbers,
    });
  }
}
