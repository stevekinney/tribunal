/**
 * Check run webhook event handler.
 * Handles: check_run.completed, check_run.rerequested, check_run.requested_action
 */

import type { CheckRunEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';
import { dispatchCheckCompletedSignals } from './check-completed-dispatch.server';
import { dispatchManualReviewSignal } from './manual-review-dispatch.server';
import { RE_REVIEW_ACTION_IDENTIFIER } from '$lib/server/github/webhooks';

/**
 * Handle check_run webhook events.
 * Check runs can reference multiple PRs; signal all of them.
 * Orchestrator-trigger actions throw on dispatch failure for 500 retry.
 * Claiming is performed at the +server.ts level for all orchestrator events.
 */
export async function handleCheckRun(
  payload: CheckRunEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { logger } = context;

  if (action === 'completed') {
    await dispatchCheckCompletedSignals(
      {
        eventLabel: 'check_run',
        prNumbers: payload.check_run.pull_requests?.map((pr) => pr.number) ?? [],
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        actorLogin: payload.sender?.login,
      },
      context,
    );
    return;
  }

  if (action === 'rerequested') {
    await dispatchManualReviewSignal(
      {
        eventLabel: 'check_run.rerequested',
        prNumbers: payload.check_run.pull_requests?.map((pr) => pr.number) ?? [],
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        headSha: payload.check_run.head_sha,
        actorLogin: payload.sender?.login,
        checkRunId: payload.check_run.id,
      },
      context,
    );
    return;
  }

  if (action === 'requested_action') {
    const identifier = payload.requested_action?.identifier;
    if (identifier !== RE_REVIEW_ACTION_IDENTIFIER) {
      logger.debug({ identifier }, 'Ignoring unknown check_run.requested_action identifier');
      return;
    }
    await dispatchManualReviewSignal(
      {
        eventLabel: 'check_run.requested_action',
        prNumbers: payload.check_run.pull_requests?.map((pr) => pr.number) ?? [],
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        headSha: payload.check_run.head_sha,
        actorLogin: payload.sender?.login,
        checkRunId: payload.check_run.id,
      },
      context,
    );
    return;
  }

  logger.debug({ action }, 'Ignoring non-actionable check_run action');
}
