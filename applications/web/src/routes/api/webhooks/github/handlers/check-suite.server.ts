/**
 * Check suite webhook event handler.
 * Handles: check_suite.completed, check_suite.rerequested
 */

import type { CheckSuiteEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';
import { dispatchCheckCompletedSignals } from './check-completed-dispatch.server';
import { dispatchManualReviewSignal } from './manual-review-dispatch.server';

/**
 * Handle check_suite webhook events.
 * Check suites can reference multiple PRs; signal all of them.
 * Orchestrator-trigger actions throw on dispatch failure for 500 retry.
 * Claiming is performed at the +server.ts level for all orchestrator events.
 */
export async function handleCheckSuite(
  payload: CheckSuiteEvent,
  context: WebhookContext,
): Promise<void> {
  const { action } = payload;
  const { logger } = context;

  if (action === 'completed') {
    await dispatchCheckCompletedSignals(
      {
        eventLabel: 'check_suite',
        prNumbers: payload.check_suite.pull_requests?.map((pr) => pr.number) ?? [],
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        actorLogin: payload.sender?.login,
      },
      context,
    );
    return;
  }

  if (action === 'rerequested') {
    // A check suite has no single check-run id to reuse — the engine falls
    // back to creating a fresh Check Run for the manual re-review (T-2).
    await dispatchManualReviewSignal(
      {
        eventLabel: 'check_suite.rerequested',
        prNumbers: payload.check_suite.pull_requests?.map((pr) => pr.number) ?? [],
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        headSha: payload.check_suite.head_sha,
        actorLogin: payload.sender?.login,
      },
      context,
    );
    return;
  }

  logger.debug({ action }, 'Ignoring non-actionable check_suite action');
}
