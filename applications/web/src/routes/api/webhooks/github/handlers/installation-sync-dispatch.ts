/**
 * Shared installation-sync dispatch for webhook handlers.
 *
 * Every webhook handler that triggers an installation sync must go through this
 * helper rather than calling `enqueueInstallationSync(...).catch(...)` directly:
 * the producer no longer throws on dispatch failure — it resolves with
 * `status: 'error'` — so a bare `.catch()` would silently drop those failures.
 */
import { enqueueInstallationSync } from '@tribunal/github/sync';
import type { EnqueueInstallationSyncOptions } from '@tribunal/github/sync';
import { githubContext } from '$lib/server/github-context';
import type { WebhookContext } from './types';

/**
 * Fire-and-forget an installation sync, logging both thrown errors and
 * `status: 'error'` results so a failed enqueue is never silently dropped.
 *
 * KNOWN DURABILITY LIMITATION (surfaced by review; not fixed in this increment):
 * the webhook delivery is claimed upstream (`claimWebhookDelivery`) BEFORE the
 * handler runs, and this enqueue is fire-and-forget (webhooks must return well
 * inside GitHub's ~10s timeout — awaiting a repo-provisioning sync would regress
 * latency once the workflow is real). So if the enqueue fails after the delivery
 * is claimed, a GitHub redelivery is deduped away and the sync is lost. This is
 * inert today (the `installation-sync` workflow is not ported, so the producer is
 * a no-op success), but BEFORE porting that workflow the enqueue must become
 * recoverable (an outbox row + reconciler, or claim-after-enqueue). See
 * documentation/WEFT_MIGRATION_PLAN.md.
 */
export function fireAndForgetInstallationSync(
  options: EnqueueInstallationSyncOptions,
  logger: WebhookContext['logger'],
): void {
  void enqueueInstallationSync(githubContext, options)
    .then((result) => {
      if (result.status === 'error') {
        logger.error(
          { error: result.error, workflowId: result.workflowId },
          'Installation sync enqueue returned an error status',
        );
      }
    })
    .catch((error) => logger.error({ error }, 'Failed to enqueue installation sync'));
}
