import type { GithubServiceContext } from '../context.js';
import { cachedRead } from '../core/github-read-client.js';
import { requirePolicy } from '../core/cache-policy.js';
import { isNotModifiedError } from '../errors.js';
import { ValidationError } from '../error-taxonomy.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Complete sorted list of known GitHub webhook event types for GitHub Apps.
 *
 * Source: https://docs.github.com/en/webhooks/webhook-events-and-payloads
 * This list should be updated when GitHub adds new webhook event types.
 */
export const ALL_GITHUB_WEBHOOK_EVENTS = Object.freeze([
  'branch_protection_configuration',
  'branch_protection_rule',
  'check_run',
  'check_suite',
  'code_scanning_alert',
  'commit_comment',
  'create',
  'custom_property',
  'custom_property_values',
  'delete',
  'dependabot_alert',
  'deploy_key',
  'deployment',
  'deployment_protection_rule',
  'deployment_review',
  'deployment_status',
  'discussion',
  'discussion_comment',
  'fork',
  'github_app_authorization',
  'gollum',
  'installation',
  'installation_repositories',
  'installation_target',
  'issue_comment',
  'issues',
  'label',
  'marketplace_purchase',
  'member',
  'membership',
  'merge_group',
  'meta',
  'milestone',
  'org_block',
  'organization',
  'package',
  'page_build',
  'personal_access_token_request',
  'ping',
  'project',
  'project_card',
  'project_column',
  'projects_v2',
  'projects_v2_item',
  'projects_v2_status_update',
  'public',
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'pull_request_review_thread',
  'push',
  'registry_package',
  'release',
  'repository',
  'repository_advisory',
  'repository_dispatch',
  'repository_import',
  'repository_ruleset',
  'repository_vulnerability_alert',
  'secret_scanning_alert',
  'secret_scanning_alert_location',
  'security_advisory',
  'security_and_analysis',
  'sponsorship',
  'star',
  'status',
  'sub_issues',
  'team',
  'team_add',
  'watch',
  'workflow_dispatch',
  'workflow_job',
  'workflow_run',
] as const);

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
 * Sorted list of events that can be explicitly subscribed/unsubscribed
 * in GitHub App settings.
 */
export const CONFIGURABLE_GITHUB_WEBHOOK_EVENTS = Object.freeze(
  ALL_GITHUB_WEBHOOK_EVENTS.filter((event) => !nonConfigurableGitHubWebhookEventSet.has(event)),
);

/** A single GitHub webhook event type string. */
export type GitHubWebhookEventType = (typeof ALL_GITHUB_WEBHOOK_EVENTS)[number];

// ============================================================================
// Types
// ============================================================================

/** Result of comparing registered events against the full event catalog. */
export interface RegisteredWebhooks {
  /** Events the GitHub App is currently subscribed to (sorted). */
  registered: string[];
  /** Configurable events the GitHub App is NOT subscribed to (sorted). */
  unregistered: string[];
}

// ============================================================================
// Main function
// ============================================================================

/**
 * Query the GitHub App configuration and diff subscribed events against
 * the full webhook event catalog.
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
      const registered: string[] = [...registeredSet].sort();

      // Warn when GitHub returns event types not present in our canonical list.
      // This indicates ALL_GITHUB_WEBHOOK_EVENTS needs updating.
      const knownEvents: ReadonlySet<string> = new Set(ALL_GITHUB_WEBHOOK_EVENTS);
      const unknownEvents = registered.filter((event) => !knownEvents.has(event));
      if (unknownEvents.length > 0) {
        console.warn(
          'GitHub returned webhook events not present in ALL_GITHUB_WEBHOOK_EVENTS. ' +
            'The constant may need updating. Unknown events:',
          unknownEvents,
        );
      }

      const unregistered: string[] = CONFIGURABLE_GITHUB_WEBHOOK_EVENTS.filter(
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
