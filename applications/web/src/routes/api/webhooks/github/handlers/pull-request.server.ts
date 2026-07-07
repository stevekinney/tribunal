/**
 * Pull request webhook event handler.
 * Handles: pull_request.opened, reopened, synchronize, closed, etc.
 */

import type { PullRequestEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';
import { githubContext } from '$lib/server/github-context';
import {
  signalPullRequestEvent,
  signalPullRequestClosed,
} from '@tribunal/github/pull-requests/state/workflow-signals';
import { kickReviewEngineAfterDurableIntent } from './review-engine-kick.server';

/**
 * Handle pull_request webhook events.
 * Review-engine trigger actions throw on durable enqueue failure for 500 retry.
 * Claiming is performed at the +server.ts level for all review-engine events.
 *
 * These dispatch through `signalPullRequestEvent` / `signalPullRequestClosed`,
 * which write idempotent `review_intent` rows for the durable engine to claim.
 */
export async function handlePullRequestEvent(
  payload: PullRequestEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { installationId, repositoryId, logger } = context;

  switch (action) {
    case 'opened':
    case 'reopened':
    case 'synchronize': {
      // Pre-LLM skip: a draft pull request is not reviewable yet. Reviewing
      // resumes on `ready_for_review` (handled below), which always enqueues
      // regardless of the current draft flag.
      if (payload.pull_request.draft) {
        logger.debug({ action }, 'Skipping review for a draft pull request');
        break;
      }
      const eventType =
        action === 'synchronize'
          ? 'pr_synchronized'
          : action === 'reopened'
            ? 'pr_reopened'
            : 'pr_opened';

      // Durable enqueue - must throw on failure for 500 response.
      const result = await signalPullRequestEvent(githubContext, {
        repositoryId,
        prNumber: payload.pull_request.number,
        installationId,
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        eventType,
        actorLogin: payload.sender?.login,
        // GitHub delivery GUID -> Weft signalId, so a 500-and-retry of this
        // delivery dedups to one signal instead of minting a fresh UUID.
        eventId: context.deliveryId,
        headSha: payload.pull_request.head.sha,
        origin: context.origin,
      });

      if (!result.ok) {
        console.error('[webhook] Failed to enqueue pull request review intent:', {
          deliveryId: context.deliveryId,
          event: 'pull_request',
          workflowId: result.workflowId,
          installationId,
          repositoryId,
          repositoryFullName: `${payload.repository.owner.login}/${payload.repository.name}`,
          pullRequestNumber: payload.pull_request.number,
          sender: payload.sender?.login,
          action,
          eventType,
          intentKind: result.intentKind,
          error: result.error,
          ...(context.hookId !== undefined ? { hookId: context.hookId } : {}),
        });
        throw new Error(
          `Failed to enqueue PR ${action} intent for workflow ${result.workflowId}: ${result.error}`,
        );
      }

      logger.info({
        message: `PR ${action} review intent enqueued`,
        intentKind: result.intentKind,
        enqueued: result.enqueued,
        enqueueStatus: result.enqueueStatus,
      });
      await kickReviewEngineAfterDurableIntent(result, logger);
      break;
    }

    case 'ready_for_review': {
      // Always enqueues regardless of the current draft flag — this is
      // precisely the transition out of draft that makes the PR reviewable.
      const eventType = 'pr_ready_for_review';

      // Durable enqueue - must throw on failure for 500 response.
      const result = await signalPullRequestEvent(githubContext, {
        repositoryId,
        prNumber: payload.pull_request.number,
        installationId,
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        eventType,
        actorLogin: payload.sender?.login,
        // GitHub delivery GUID -> Weft signalId, so a 500-and-retry of this
        // delivery dedups to one signal instead of minting a fresh UUID.
        eventId: context.deliveryId,
        headSha: payload.pull_request.head.sha,
        origin: context.origin,
      });

      if (!result.ok) {
        console.error('[webhook] Failed to enqueue pull request review intent:', {
          deliveryId: context.deliveryId,
          event: 'pull_request',
          workflowId: result.workflowId,
          installationId,
          repositoryId,
          repositoryFullName: `${payload.repository.owner.login}/${payload.repository.name}`,
          pullRequestNumber: payload.pull_request.number,
          sender: payload.sender?.login,
          action,
          eventType,
          intentKind: result.intentKind,
          error: result.error,
          ...(context.hookId !== undefined ? { hookId: context.hookId } : {}),
        });
        throw new Error(
          `Failed to enqueue PR ${action} intent for workflow ${result.workflowId}: ${result.error}`,
        );
      }

      logger.info({
        message: `PR ${action} review intent enqueued`,
        intentKind: result.intentKind,
        enqueued: result.enqueued,
        enqueueStatus: result.enqueueStatus,
      });
      await kickReviewEngineAfterDurableIntent(result, logger);
      break;
    }

    case 'closed': {
      // Durable enqueue - must throw on failure for 500 response.
      const result = await signalPullRequestClosed(githubContext, {
        repositoryId,
        prNumber: payload.pull_request.number,
        merged: payload.pull_request.merged ?? false,
        actorLogin: payload.sender?.login,
        eventId: context.deliveryId,
        headSha: payload.pull_request.head.sha,
      });

      if (!result.ok) {
        console.error('[webhook] Failed to enqueue PR closed review intent:', {
          deliveryId: context.deliveryId,
          event: 'pull_request',
          workflowId: result.workflowId,
          installationId,
          repositoryId,
          repositoryFullName: `${payload.repository.owner.login}/${payload.repository.name}`,
          pullRequestNumber: payload.pull_request.number,
          sender: payload.sender?.login,
          action,
          error: result.error,
          ...(context.hookId !== undefined ? { hookId: context.hookId } : {}),
        });
        throw new Error(
          `Failed to enqueue PR closed intent for workflow ${result.workflowId}: ${result.error}`,
        );
      }

      logger.info({
        message: 'PR closed review intent enqueued',
        intentKind: result.intentKind,
        enqueued: result.enqueued,
        enqueueStatus: result.enqueueStatus,
      });
      await kickReviewEngineAfterDurableIntent(result, logger);
      break;
    }

    default:
      logger.debug({ action }, 'Unhandled pull_request action');
  }
}
