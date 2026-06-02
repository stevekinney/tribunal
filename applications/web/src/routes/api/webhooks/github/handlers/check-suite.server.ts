/**
 * Check suite webhook event handler.
 * Handles: check_suite.completed
 */

import type { CheckSuiteEvent } from '@octokit/webhooks-types';
import type { WebhookContext } from './types';
import { dispatchCheckCompletedSignals } from './check-completed-dispatch.server';

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

  if (action !== 'completed') {
    logger.debug({ action }, 'Ignoring non-completed check_suite action');
    return;
  }

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
}
