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
 *   - `warnOnGitHubAppConfigurationDriftAtStartup` logs the event and
 *     permission diffs together once at server boot (wired as SvelteKit's
 *     `init` hook in `hooks.server.ts`), so drift is visible in deploy/process
 *     logs without anyone needing to know to query `GET /api/webhooks/github`
 *     first.
 */
import {
  getGitHubAppConfiguration,
  type GitHubAppPermissionLevel,
  type GitHubAppPermissions,
  NON_CONFIGURABLE_GITHUB_WEBHOOK_EVENTS,
} from '@tribunal/github/webhooks/registered-webhooks';
import { githubContext } from '$lib/server/github-context';
import { HANDLED_GITHUB_WEBHOOK_EVENT_TYPES } from './handled-event-types';

const nonConfigurableEventSet: ReadonlySet<string> = new Set(
  NON_CONFIGURABLE_GITHUB_WEBHOOK_EVENTS,
);

type RequiredGitHubAppPermission = {
  permission: string;
  level: GitHubAppPermissionLevel;
};

export type GitHubAppPermissionDrift = RequiredGitHubAppPermission & {
  configured: GitHubAppPermissionLevel | 'missing';
};

const permissionRank: Readonly<Record<GitHubAppPermissionLevel, number>> = {
  read: 1,
  write: 2,
  admin: 3,
};

/**
 * GitHub App permissions required by Tribunal's supported GitHub browsing and
 * webhook surfaces.
 *
 * This list is intentionally explicit instead of derived from REST method
 * names. GitHub permissions are product-level contracts, not a one-to-one
 * mapping from endpoint namespaces:
 *
 * - `administration:read`: default-branch ruleset/protection reads.
 * - `checks:read`: check-run reads for dashboard and webhook follow-up paths.
 * - `contents:read`: repository file, branch, commit, and diff context reads.
 * - `issues:read`: issue list/detail/comment reads plus `issues` and
 *   `issue_comment` webhook subscriptions.
 * - `members:read`: member/team/organization access-change webhook delivery.
 * - `metadata:read`: repository discovery and installation metadata.
 * - `organization_administration:read`: organization-level membership/access
 *   webhook delivery used to invalidate access caches.
 * - `pull_requests:read`: pull request list/detail/diff/review reads plus pull
 *   request webhook subscriptions.
 * - `statuses:read`: combined commit-status reads and `status` webhook
 *   subscription.
 */
export const REQUIRED_GITHUB_APP_PERMISSIONS: readonly RequiredGitHubAppPermission[] = [
  { permission: 'administration', level: 'read' },
  { permission: 'checks', level: 'read' },
  { permission: 'contents', level: 'read' },
  { permission: 'issues', level: 'read' },
  { permission: 'members', level: 'read' },
  { permission: 'metadata', level: 'read' },
  { permission: 'organization_administration', level: 'read' },
  { permission: 'pull_requests', level: 'read' },
  { permission: 'statuses', level: 'read' },
] as const;

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

export function computeRequiredGitHubAppPermissionDrift(
  grantedPermissions: Readonly<GitHubAppPermissions>,
  requiredPermissions: readonly RequiredGitHubAppPermission[] = REQUIRED_GITHUB_APP_PERMISSIONS,
): GitHubAppPermissionDrift[] {
  return requiredPermissions
    .filter(({ permission, level }) => {
      const actual = grantedPermissions[permission];
      return actual === undefined || permissionRank[actual] < permissionRank[level];
    })
    .map(({ permission, level }) => ({
      permission,
      level,
      configured: grantedPermissions[permission] ?? 'missing',
    }))
    .sort((left, right) =>
      left.permission < right.permission ? -1 : left.permission > right.permission ? 1 : 0,
    );
}

/**
 * Warn (never throw) once at server startup when the GitHub App's webhook
 * subscription or App-level requested permissions are missing runtime behavior Tribunal
 * relies on.
 *
 * Unlike `assertDevAuthBypassNotInProduction` / `assertE2EModeNotInProduction`,
 * this is not a security guard — configuration drift is an operational
 * blind spot, not an exploitable bypass — so it only ever logs, it never
 * throws or blocks startup. The GitHub App may also be legitimately
 * unconfigured in some environments (local dev, CI, preview sandboxes); that
 * already-expected case is logged at most and is never reported as drift,
 * since we have no subscription data to diff in the first place.
 *
 * Bypasses the cache: a redeploy shortly after an operator fixes the
 * subscription is exactly when a fresh check is most valuable -- a cached
 * (up to 24h stale) read here would keep logging the pre-fix drift warning
 * on every restart until the cache entry naturally expires, per
 * `.claude/rules/github-api.md`'s write-then-read bypass carve-out.
 */
export async function warnOnGitHubAppConfigurationDriftAtStartup(): Promise<void> {
  let registered: string[];
  let configuredPermissions: GitHubAppPermissions;
  try {
    ({ registered, permissions: configuredPermissions } = await getGitHubAppConfiguration(
      githubContext,
      {
        bypass: true,
      },
    ));
  } catch (error) {
    console.warn(
      '[github-app-configuration] Could not determine the GitHub App webhook subscription ' +
        'and permissions at startup; skipping the drift check:',
      error,
    );
    return;
  }

  const driftedEvents = computeHandledWebhookEventDrift(registered);
  const driftedPermissions = computeRequiredGitHubAppPermissionDrift(configuredPermissions);
  if (driftedEvents.length === 0 && driftedPermissions.length === 0) return;

  console.warn(
    '[github-app-configuration] GitHub App configuration drift detected. Missing webhook ' +
      `event subscriptions: ${formatEventDrift(driftedEvents)}. Insufficient requested App permissions: ` +
      `${formatPermissionDrift(driftedPermissions)}. Webhook deliveries for missing event ` +
      'types will never arrive, and newly-restored deliveries may fail with 403s until the ' +
      'GitHub App permissions are updated and installation owners accept the request. See documentation/INTEGRATIONS.md#subscribed-events ' +
      'for the expected configuration list and how to confirm the fix.',
  );
}

function formatEventDrift(driftedEvents: readonly string[]): string {
  return driftedEvents.length > 0 ? driftedEvents.join(', ') : 'none';
}

function formatPermissionDrift(driftedPermissions: readonly GitHubAppPermissionDrift[]): string {
  if (driftedPermissions.length === 0) return 'none';
  return driftedPermissions
    .map(({ permission, level, configured }) => `${permission} (${configured} < ${level})`)
    .join(', ');
}
