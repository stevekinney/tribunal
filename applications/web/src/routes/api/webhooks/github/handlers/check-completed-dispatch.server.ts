/**
 * Shared orchestrator dispatch logic for check_run.completed and check_suite.completed events.
 * Both event types reference a list of associated PRs and signal each one via the orchestrator.
 */

import type { WebhookContext } from './types';
import { githubContext } from '$lib/server/github-context';
import { signalPullRequestEvent } from '@tribunal/github/pull-requests/state/workflow-signals';

/**
 * Parameters for dispatching check-completed orchestrator signals.
 */
export interface CheckCompletedDispatchOptions {
  /** Human-readable event label used in log messages (e.g. "check_run" or "check_suite"). */
  eventLabel: string;
  /** PR numbers extracted from the event payload's associated pull requests list. */
  prNumbers: number[];
  /** Repository owner login. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Actor login for the signal (sender). */
  actorLogin: string | undefined;
}

/**
 * Dispatch orchestrator signals for all PRs associated with a completed check run or suite.
 * Throws if any signal fails, so the outer handler can return a 500 for GitHub to retry.
 *
 * Routes check-completed signals into the registered pull-request-orchestrator
 * Weft workflow via signalPullRequestEvent (start-or-signal, coalesced).
 */
export async function dispatchCheckCompletedSignals(
  options: CheckCompletedDispatchOptions,
  context: WebhookContext,
): Promise<void> {
  const { eventLabel, prNumbers, owner, repo, actorLogin } = options;
  const { installationId, repositoryId, logger } = context;

  if (prNumbers.length === 0) {
    logger.debug(`${eventLabel} has no associated PRs`);
    return;
  }

  const results = await Promise.all(
    prNumbers.map((prNumber) =>
      signalPullRequestEvent(githubContext, {
        workspaceId: 0,
        repositoryId,
        prNumber,
        installationId,
        owner,
        repo,
        eventType: 'check_completed',
        actorLogin,
        // GitHub delivery GUID -> Weft signalId for retry dedup. One delivery can
        // fan out to several PRs, but each targets a distinct orchestrator
        // workflow id, so the shared GUID cannot collide across PRs.
        eventId: context.deliveryId,
      }),
    ),
  );

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    const details = failures.map((f) => `${f.workflowId}: ${f.error}`).join(', ');
    throw new Error(
      `Failed to signal ${eventLabel}.completed for ${failures.length} PR(s): ${details}`,
    );
  }

  logger.info(`${eventLabel} completed workflow signaled for ${prNumbers.length} PR(s)`);
}
