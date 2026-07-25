/**
 * The GitHub webhook event types Tribunal's ingress route
 * (`applications/web/src/routes/api/webhooks/github/+server.ts`) can actually
 * act on, split by dispatch path.
 *
 * This is the single source of truth for "what does Tribunal handle" — the
 * ingress route imports {@link ROUTER_HANDLED_GITHUB_WEBHOOK_EVENT_TYPES} for
 * its Zod-validation-failure guard, and the webhook subscription drift check
 * (`./subscription-drift`) imports {@link HANDLED_GITHUB_WEBHOOK_EVENT_TYPES}
 * (the union of both paths) as its drift baseline.
 *
 * Deliberately NOT the same thing as `SUPPORTED_GITHUB_WEBHOOK_EVENT_CATALOG`
 * or `CONFIGURABLE_GITHUB_WEBHOOK_EVENT_CATALOG` from
 * `@tribunal/github/webhooks/registered-webhooks` — those describe every
 * event type GitHub can possibly send, most of which Tribunal has no handler
 * for and has no reason to ever subscribe to.
 */

/**
 * Event types routed through `createGithubWebhookRouter` (Zod-validated,
 * schema-driven dispatch). Keep in sync with the router wiring in
 * `+server.ts`'s `createWebhookDispatcher`.
 */
export const ROUTER_HANDLED_GITHUB_WEBHOOK_EVENT_TYPES = [
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'check_run',
  'check_suite',
  'installation',
  'installation_repositories',
  'installation_target',
  'github_app_authorization',
  'push',
] as const;

/**
 * Event types dispatched through the manual fallback path in `+server.ts`
 * (no Zod schema in `github-webhook-schemas`, dispatched by event type/action
 * string matching instead of the typed router).
 */
export const MANUAL_FALLBACK_GITHUB_WEBHOOK_EVENT_TYPES = [
  'issue_comment',
  'pull_request_review_thread',
] as const;

/**
 * Event types that never go through the typed router or the manual-fallback
 * path, but still cause real, unconditional side effects in every request
 * `+server.ts` handles (steps 7-9: repository metadata sync, access/resource
 * cache invalidation, and webhook-event storage/extraction). Each entry below
 * is load-bearing — a missing subscription for it is a genuine functional
 * gap, not just noise:
 *
 * - `repository` (`renamed`/`transferred`/`edited` actions): the ONLY path
 *   that keeps stored repository owner/name/default-branch in sync for an
 *   already-installed repository. `installation`/`installation_repositories`
 *   only resync on installation-membership changes, not a plain rename —
 *   missing this leaves stale data with no self-healing path.
 *   See `handleRepositoryMetadataEvents`
 *   (`packages/github/src/webhooks/handlers/repository.ts`).
 * - `member`, `team`, `organization`, `membership`: invalidate the GitHub
 *   access cache so revoked/granted repository access takes effect promptly
 *   instead of waiting out the cache TTL.
 *   See `invalidateGitHubAccessCacheForEvent`
 *   (`packages/github/src/webhooks/access-invalidation.ts`).
 * - `issues`: persisted into `webhook_event` (via `extractEventFields`) for
 *   the audit trail and event-listener matching, and invalidates issue
 *   list/detail caches, the same way `pull_request`/`issue_comment` do.
 * - `status`: invalidates the failing-check-count and branch-CI-status
 *   caches, the same way `check_run`/`check_suite` do.
 *   See `invalidateGitHubResourceCacheForEvent`
 *   (`packages/github/src/webhooks/resource-invalidation.ts`).
 */
export const UNCONDITIONAL_SIDE_EFFECT_GITHUB_WEBHOOK_EVENT_TYPES = [
  'repository',
  'member',
  'team',
  'organization',
  'membership',
  'issues',
  'status',
] as const;

/**
 * Every event type Tribunal can act on, across all three dispatch/side-effect
 * paths. This is the drift baseline: if the GitHub App is not subscribed to
 * one of these, Tribunal silently never sees it.
 */
export const HANDLED_GITHUB_WEBHOOK_EVENT_TYPES = [
  ...ROUTER_HANDLED_GITHUB_WEBHOOK_EVENT_TYPES,
  ...MANUAL_FALLBACK_GITHUB_WEBHOOK_EVENT_TYPES,
  ...UNCONDITIONAL_SIDE_EFFECT_GITHUB_WEBHOOK_EVENT_TYPES,
] as const;
