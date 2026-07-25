/**
 * Detects drift between the GitHub App's live webhook subscription and the
 * event types Tribunal's ingress route can actually act on
 * (`HANDLED_GITHUB_WEBHOOK_EVENT_TYPES`).
 *
 * `/webhooks` only ever shows event types that were either received or
 * currently subscribed — a subscription that has drifted down to a single
 * event type looks identical to a healthy, quiet installation unless
 * something explicitly diffs "subscribed" against "handled". This module is
 * that diff, used two ways:
 *
 *   - `computeHandledWebhookEventDrift` powers the `/webhooks` page banner
 *     (`(authenticated)/webhooks/+page.server.ts`).
 *   - `warnOnHandledWebhookEventDriftAtStartup` logs the same diff once at
 *     server boot (wired as SvelteKit's `init` hook in `hooks.server.ts`), so
 *     drift is visible in deploy/process logs without anyone needing to know
 *     to query `GET /api/webhooks/github` first.
 */
import {
  getRegisteredWebhooks,
  NON_CONFIGURABLE_GITHUB_WEBHOOK_EVENTS,
} from '@tribunal/github/webhooks/registered-webhooks';
import { githubContext } from '$lib/server/github-context';
import { HANDLED_GITHUB_WEBHOOK_EVENT_TYPES } from './handled-event-types';

const nonConfigurableEventSet: ReadonlySet<string> = new Set(
  NON_CONFIGURABLE_GITHUB_WEBHOOK_EVENTS,
);

/**
 * Handled event types the GitHub App is not currently subscribed to.
 *
 * Excludes the three non-configurable events (`github_app_authorization`,
 * `installation`, `installation_repositories`) — GitHub delivers these
 * regardless of subscription settings and typically omits them from the
 * `events` list `getRegisteredWebhooks` returns, so treating their absence as
 * drift would be a permanent false positive.
 *
 * Deliberately does NOT use `getRegisteredWebhooks(...).unregistered` as a
 * shortcut: that field is diffed against the full configurable event
 * *catalog* (every event type GitHub can send), not against what Tribunal
 * actually handles, and would report dozens of irrelevant event types as
 * "missing".
 */
export function computeHandledWebhookEventDrift(
  registeredEventTypes: readonly string[],
  handledEventTypes: readonly string[] = HANDLED_GITHUB_WEBHOOK_EVENT_TYPES,
): string[] {
  const registeredSet = new Set(registeredEventTypes);
  return handledEventTypes
    .filter((eventType) => !registeredSet.has(eventType) && !nonConfigurableEventSet.has(eventType))
    .sort();
}

/**
 * Warn (never throw) once at server startup when the GitHub App's webhook
 * subscription is missing event types Tribunal can act on.
 *
 * Unlike `assertDevAuthBypassNotInProduction` / `assertE2EModeNotInProduction`,
 * this is not a security guard — subscription drift is an operational
 * blind spot, not an exploitable bypass — so it only ever logs, it never
 * throws or blocks startup. The GitHub App may also be legitimately
 * unconfigured in some environments (local dev, CI, preview sandboxes); that
 * already-expected case is logged at most and is never reported as drift,
 * since we have no subscription data to diff in the first place.
 */
export async function warnOnHandledWebhookEventDriftAtStartup(): Promise<void> {
  let registered: string[];
  try {
    ({ registered } = await getRegisteredWebhooks(githubContext));
  } catch (error) {
    console.warn(
      '[webhook-subscription] Could not determine the GitHub App webhook subscription at ' +
        'startup; skipping the drift check:',
      error,
    );
    return;
  }

  const drifted = computeHandledWebhookEventDrift(registered);
  if (drifted.length === 0) return;

  console.warn(
    `[webhook-subscription] GitHub App is not subscribed to webhook event types Tribunal can ` +
      `act on: ${drifted.join(', ')}. Webhook deliveries for these event types will never ` +
      `arrive until the GitHub App's webhook event subscription is updated to include them. ` +
      'See documentation/INTEGRATIONS.md#subscribed-events for the expected subscription list ' +
      'and how to confirm the fix.',
  );
}
