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
 * KNOWN DURABILITY LIMITATION (pre-production gate — see WEFT_MIGRATION_PLAN.md §4.2):
 * the webhook delivery is claimed upstream (`claimWebhookDelivery`) BEFORE the
 * handler runs, and this enqueue is fire-and-forget (webhooks must return well
 * inside GitHub's ~10s timeout — awaiting a repo-provisioning sync would regress
 * latency). So if the enqueue fails after the delivery is claimed, a GitHub
 * redelivery is deduped away and the sync is lost.
 *
 * The `installation-sync` workflow is now ported, BUT the engine only runs when
 * `WEFT_DATABASE_URL` is configured; until then the producer is a log-only no-op
 * success and this gap is operationally inert. Threading the delivery GUID as the
 * Weft `signalId` (below) adds dedup at the signal layer. The remaining fix —
 * making the enqueue itself recoverable (an outbox row + reconciler, or
 * claim-after-enqueue) — is a separate change to the webhook delivery path and is
 * a HARD PREREQUISITE before enabling `WEFT_DATABASE_URL` in production.
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
