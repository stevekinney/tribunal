/**
 * Re-run trigger detection for GitHub webhooks.
 *
 * `check_run.rerequested`, `check_run.requested_action`, and
 * `check_suite.rerequested` let a human re-run a check from the PR's Checks
 * tab. Non-`completed` actions on these event types are otherwise discarded
 * pre-database (see `isPreDatabaseIgnoredWebhook` in the webhook route) — this
 * module carves out the narrow exception: only Tribunal's own check runs,
 * only the `re-review` action identifier, so other apps' re-run clicks stay
 * ignored.
 */

import type { WebhookPayload } from './types.js';

/** Only this action identifier is handled; unknown identifiers are a no-op. */
export const RE_REVIEW_ACTION_IDENTIFIER = 're-review';

/**
 * True when a `check_run`/`check_suite` payload's `app.id` matches the
 * configured Tribunal GitHub App id. Comparison is string-based because
 * `GITHUB_APP_ID` is an environment string and the payload's `app.id` is a
 * JSON number.
 */
export function isOwnGithubAppCheckEvent(
  data: WebhookPayload,
  eventType: string | null,
  ownAppId: string | undefined,
): boolean {
  if (!ownAppId) return false;

  const appId =
    eventType === 'check_run'
      ? getCheckRunAppId(data)
      : eventType === 'check_suite'
        ? getCheckSuiteAppId(data)
        : undefined;

  return appId !== undefined && String(appId) === ownAppId;
}

/**
 * True when this webhook is a re-run trigger Tribunal must act on:
 * `check_run.rerequested`, `check_run.requested_action` (identifier
 * `re-review`), or `check_suite.rerequested` — and the check belongs to
 * Tribunal's own app. Other apps' check events, and unknown action
 * identifiers, return false so they stay pre-database-ignored.
 */
export function isRerunTriggerWebhookEvent(
  eventType: string | null,
  action: string | null,
  data: WebhookPayload,
  ownAppId: string | undefined,
): boolean {
  if (!isOwnGithubAppCheckEvent(data, eventType, ownAppId)) return false;

  if (eventType === 'check_run' && action === 'rerequested') return true;
  if (eventType === 'check_run' && action === 'requested_action') {
    return getRequestedActionIdentifier(data) === RE_REVIEW_ACTION_IDENTIFIER;
  }
  if (eventType === 'check_suite' && action === 'rerequested') return true;

  return false;
}

function getCheckRunAppId(data: WebhookPayload): number | string | undefined {
  const checkRun = data.check_run as { app?: { id?: number } } | undefined;
  return checkRun?.app?.id;
}

function getCheckSuiteAppId(data: WebhookPayload): number | string | undefined {
  const checkSuite = data.check_suite as { app?: { id?: number } } | undefined;
  return checkSuite?.app?.id;
}

function getRequestedActionIdentifier(data: WebhookPayload): string | undefined {
  const requestedAction = data.requested_action as { identifier?: string } | undefined;
  return requestedAction?.identifier;
}
