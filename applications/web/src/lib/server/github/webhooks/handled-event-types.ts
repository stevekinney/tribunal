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
 * Every event type Tribunal can act on, across both dispatch paths. This is
 * the drift baseline: if the GitHub App is not subscribed to one of these,
 * Tribunal silently never sees it.
 */
export const HANDLED_GITHUB_WEBHOOK_EVENT_TYPES = [
  ...ROUTER_HANDLED_GITHUB_WEBHOOK_EVENT_TYPES,
  ...MANUAL_FALLBACK_GITHUB_WEBHOOK_EVENT_TYPES,
] as const;
