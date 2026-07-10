import { emitterEventNames } from '@octokit/webhooks';
import type { GithubServiceContext } from '../context.js';
import { cachedRead } from '../core/github-read-client.js';
import { requirePolicy } from '../core/cache-policy.js';
import { isNotModifiedError } from '../errors.js';
import { ValidationError } from '../error-taxonomy.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Complete sorted catalog of GitHub webhook event *types* (excluding
 * action-qualified variants), derived at runtime from the installed
 * `@octokit/webhooks` package's generated `emitterEventNames` export.
 *
 * `emitterEventNames` mixes bare event names (`check_run`) with dotted
 * action-qualified variants (`check_run.completed`); filtering out entries
 * that contain a `.` yields the event-type catalog. This is intentionally
 * NOT a hand-maintained list — it tracks whatever `@octokit/webhooks` ships,
 * so it stays current when GitHub adds new webhook event types and the
 * dependency is upgraded.
 */
export const SUPPORTED_GITHUB_WEBHOOK_EVENT_CATALOG = Object.freeze(
  [...new Set(emitterEventNames.filter((name) => !name.includes('.')))].sort(),
);

/**
 * GitHub App events that are delivered by default and cannot be configured
 * from the App webhook subscription settings.
 */
export const NON_CONFIGURABLE_GITHUB_WEBHOOK_EVENTS = Object.freeze([
  'github_app_authorization',
  'installation',
  'installation_repositories',
] as const);

const nonConfigurableGitHubWebhookEventSet: ReadonlySet<string> = new Set(
  NON_CONFIGURABLE_GITHUB_WEBHOOK_EVENTS,
);

/**
 * Sorted list of catalog events that can be explicitly subscribed/unsubscribed
 * in GitHub App settings.
 */
export const CONFIGURABLE_GITHUB_WEBHOOK_EVENT_CATALOG = Object.freeze(
  SUPPORTED_GITHUB_WEBHOOK_EVENT_CATALOG.filter(
    (event) => !nonConfigurableGitHubWebhookEventSet.has(event),
  ),
);

/** A single GitHub webhook event type string from the generated catalog. */
export type GitHubWebhookEventType = (typeof SUPPORTED_GITHUB_WEBHOOK_EVENT_CATALOG)[number];

// ============================================================================
// Types
// ============================================================================

/** Result of comparing subscribed events against the generated event catalog. */
export interface RegisteredWebhooks {
  /**
   * Events the GitHub App is currently subscribed to (sorted), exactly as
   * returned by `octokit.rest.apps.getAuthenticated()`. Event types GitHub
   * returns that are not present in the generated catalog are preserved here
   * rather than filtered out.
   */
  registered: string[];
  /** Configurable catalog events the GitHub App is NOT subscribed to (sorted). */
  unregistered: string[];
}

// ============================================================================
// Main function
// ============================================================================

/**
 * Query the GitHub App configuration and diff subscribed events against
 * the `@octokit/webhooks`-generated event catalog.
 *
 * Uses `cachedRead` with a 24-hour TTL and ETag conditional requests,
 * since webhook configuration changes are rare.
 *
 * Cache invalidation:
 * This call uses the cache policy `"get-app-webhook-configuration"` with
 * key `GITHUB_APP_WEBHOOK_CONFIGURATION`. If the GitHub App's webhook
 * subscriptions are changed (for example, via the GitHub App settings UI),
 * delete that cache key to force a fresh fetch on the next request.
 * The entry will also naturally expire after 24 hours.
 */
export async function getRegisteredWebhooks(
  context: GithubServiceContext,
): Promise<RegisteredWebhooks> {
  const policy = requirePolicy('get-app-webhook-configuration');

  const fetchFunction = async (etag?: string) => {
    const app = context.getGithubApplication?.();
    if (!app) {
      throw new ValidationError('GitHub App is not configured');
    }

    try {
      const response = await app.octokit.rest.apps.getAuthenticated({
        headers: etag ? { 'if-none-match': etag } : undefined,
      });

      const events = response.data?.events ?? [];
      const registeredSet = new Set(events);
      // Preserve every event GitHub reports, including ones the generated
      // catalog does not (yet) recognize — never silently drop them.
      const registered: string[] = [...registeredSet].sort();

      // Warn when GitHub returns event types not present in the generated
      // catalog. This usually means `@octokit/webhooks` needs upgrading.
      const knownEvents: ReadonlySet<string> = new Set(SUPPORTED_GITHUB_WEBHOOK_EVENT_CATALOG);
      const unknownEvents = registered.filter((event) => !knownEvents.has(event));
      if (unknownEvents.length > 0) {
        console.warn(
          'GitHub returned webhook events not present in the @octokit/webhooks-generated ' +
            'catalog. Upgrading @octokit/webhooks may resolve this. Unknown events:',
          unknownEvents,
        );
      }

      const unregistered: string[] = CONFIGURABLE_GITHUB_WEBHOOK_EVENT_CATALOG.filter(
        (event) => !registeredSet.has(event),
      );

      return {
        data: { registered, unregistered } satisfies RegisteredWebhooks,
        etag: response.headers.etag,
      };
    } catch (error) {
      if (etag && isNotModifiedError(error)) {
        return { notModified: true as const };
      }
      throw error;
    }
  };

  const { value } = await cachedRead<RegisteredWebhooks>(context.cache, policy, fetchFunction, []);
  return value;
}
