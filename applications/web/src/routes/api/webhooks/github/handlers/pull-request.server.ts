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

/**
 * Handle pull_request webhook events.
 * Orchestrator-trigger actions (opened, reopened) throw on dispatch failure for 500 retry.
 * The synchronize action is not dispatched to the orchestrator (matches pre-refactor behavior).
 * Claiming is performed at the +server.ts level for all orchestrator events.
 *
 * TODO(weft): Route pull request open/reopen/close signals into a ../weft pull
 * request orchestrator workflow instead of the current workflow-signals stub.
 */
export async function handlePullRequestEvent(
  payload: PullRequestEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { installationId, repositoryId, logger } = context;

  switch (action) {
    case 'opened':
    case 'reopened': {
      // Orchestrator dispatch - must throw on failure for 500 response
      const result = await signalPullRequestEvent(githubContext, {
        workspaceId: 0,
        repositoryId,
        prNumber: payload.pull_request.number,
        installationId,
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        eventType: 'pr_opened',
        actorLogin: payload.sender?.login,
      });

      if (!result.ok) {
        console.error('[webhook] Failed to signal pull request event:', {
          deliveryId: context.deliveryId,
          event: 'pull_request',
          workflowId: result.workflowId,
          installationId,
          repositoryId,
          repositoryFullName: `${payload.repository.owner.login}/${payload.repository.name}`,
          pullRequestNumber: payload.pull_request.number,
          sender: payload.sender?.login,
          action,
          eventType: 'pr_opened',
          error: result.error,
          ...(context.hookId !== undefined ? { hookId: context.hookId } : {}),
        });
        throw new Error(
          `Failed to signal PR ${action} for workflow ${result.workflowId}: ${result.error}`,
        );
      }

      logger.info(`PR ${action} workflow signaled`);
      break;
    }

    case 'closed': {
      // Orchestrator dispatch - must throw on failure for 500 response
      const result = await signalPullRequestClosed(githubContext, {
        repositoryId,
        prNumber: payload.pull_request.number,
        merged: payload.pull_request.merged ?? false,
        actorLogin: payload.sender?.login,
      });

      if (!result.ok) {
        console.error('[webhook] Failed to signal PR closed:', {
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
          `Failed to signal PR closed for workflow ${result.workflowId}: ${result.error}`,
        );
      }

      logger.info('PR closed workflow signaled');
      break;
    }

    case 'synchronize':
      // synchronize events are not orchestrator-trigger events;
      // they are handled via cache invalidation and PR state tracking only
      logger.debug('PR synchronize handled via cache invalidation path');
      break;

    default:
      logger.debug({ action }, 'Unhandled pull_request action');
  }
}
