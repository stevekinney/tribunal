# Integrations

Tribunal has exactly one external integration: **GitHub**. There is no Linear, Notion, Slack, Google Drive, or any other provider. GitHub serves two distinct roles, and it is worth keeping them separate in your head:

- **Identity** comes from GitHub OAuth. You log in with your GitHub account.
- **Repository access and webhooks** come from a GitHub App installation. After logging in, you install the Tribunal GitHub App into the organizations and accounts whose repositories you want to see.

The surviving user flow is short: log in with GitHub, install the GitHub App, browse your repositories, and view open pull requests for those repositories.

## Authentication: GitHub OAuth

OAuth establishes _who you are_. The flow lives in `applications/web/src/routes/login/github/`.

- `GET /login/github` (`+server.ts`) creates CSRF state, sets a state cookie, and redirects to GitHub's authorization URL requesting the `user:email` scope (so private email addresses are available for account linking). It uses the provider client from `$lib/server/auth/providers`, built on [Arctic](https://arcticjs.dev/).
- `GET /login/github/callback` (`+server.ts`) validates the returned state, exchanges the code for a token, fetches the GitHub user, and establishes a session.

Relevant environment variables: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`.

## Repository access: GitHub App installation

The OAuth login does not grant access to any repository contents. That requires installing the GitHub App. The flow lives in `applications/web/src/routes/connect/github/`.

- `GET /connect/github` (`+server.ts`) requires a logged-in user, generates install state for CSRF protection and callback binding, sets the `github_app_state` cookie, and redirects to `https://github.com/apps/${GITHUB_APP_NAME}/installations/new`.
- `GET /connect/github/callback` (`+server.ts`) binds the resulting installation to the logged-in Tribunal user and persists the installation record.

The installation is what produces an installation access token, which the server uses to read repositories and pull requests on your behalf.

Relevant environment variables: `GITHUB_APP_ID`, `GITHUB_APP_NAME`, `GITHUB_APP_PRIVATE_KEY`.

## Webhooks

GitHub sends webhook events to `POST /api/webhooks/github` (`applications/web/src/routes/api/webhooks/github/+server.ts`). The ingress pipeline is intact end to end; what it does _not_ do anymore is hand off to any background worker or workflow runtime. There is no Temporal and no workers application. Handlers persist data, invalidate caches, and log what _would_ have been dispatched.

The request lifecycle:

1. **Validate and extract.** Parse headers and payload (`validateRequest`).
2. **Verify the signature first.** HMAC verification against `GITHUB_APP_WEBHOOK_SECRET` happens before any processing (`verifySignature`). An unconfigured secret returns `500`.
3. **Claim the delivery (deduplicate).** `claimWebhookDelivery` records the delivery ID so retries and duplicate deliveries are skipped. Most events claim early; pull-request-style events defer the claim until after successful processing so GitHub can retry on a transient `500`.
4. **Store the event.** Events carrying a repository are persisted via `storeWebhookEvent` (from `@tribunal/github/webhooks/webhook-events`) for auditability.
5. **Route to a typed handler.** A per-request router from `github-webhook-schemas/registry` validates the payload against Zod schemas and dispatches to the matching handler in `./handlers/`. `issue_comment` and `pull_request_review_thread` are routed through a manual fallback path.
6. **Invalidate caches and track state.** Access and resource caches are invalidated for events that change repository data, repository rename/transfer events are reconciled, and pull-request state tracking runs fire-and-forget.

### What the handlers actually do

The handlers live in `applications/web/src/routes/api/webhooks/github/handlers/` and cover installation lifecycle, installation repositories, pull requests, reviews, review comments, review threads, check runs, check suites, pushes, and authorization revocation.

Some still call functions with names like `signalPullRequestEvent` and `signalPullRequestClosed` (from `@tribunal/github/pull-requests/state/workflow-signals`). These are **stubs**: the workflow dispatch they once drove has been removed, and they now `console.log` the signal that would have been sent and return success so existing call sites keep compiling. The `+server.ts` ingress likewise logs `[webhook] would dispatch pull-request-review workflow` instead of dispatching anything. Treat these as no-ops, not live orchestration.

Installation lifecycle events do perform real work — they upsert or update installation records and enqueue repository sync — because those keep the flat data model consistent.

### Subscribed events

`packages/github/src/webhooks/registered-webhooks.ts` holds the canonical catalog of GitHub App webhook event types (`ALL_GITHUB_WEBHOOK_EVENTS`) and distinguishes configurable events from the always-delivered, non-configurable ones (`github_app_authorization`, `installation`, `installation_repositories`). `GET /api/webhooks/github` (authenticated) diffs the App's currently subscribed events against that catalog so you can spot drift.

## Data model produced by these integrations

GitHub is the only source of records, and the model is intentionally flat (schema in `packages/database/src/schema/`):

```
user
  └─ github_installation                  (GitHub App install, bound to a user)
       └─ github_installation_repository  (join: which repos this install covers)
            └─ repository                  (repo identity persisted from GitHub)
```

Pull requests are **not** stored: they are read live from the GitHub API at render time for the repositories an installation covers (see `@tribunal/github/pull-requests/service`). Supporting tables include OAuth/session records, user API keys, and the webhook audit tables (`webhook_event`, `github_webhook_delivery`). There are no workspaces, projects, agents, or any other higher-level constructs.

## Caching rule

All GitHub API _read_ operations in `packages/github/` go through the `cachedRead` abstraction (`@tribunal/github/core/github-read-client`) with a registered cache policy. See `.claude/rules/github-api.md` for the required pattern, when to bypass the cache, and how to register a new cached endpoint.

## Local verification

```bash
bun install
bun run test            # package + app test suites
bun run db:migrate      # apply Drizzle migrations to your database
```

To exercise webhooks locally, expose your dev server with a tunnel, point the GitHub App's webhook URL at `<tunnel>/api/webhooks/github`, and set `GITHUB_APP_WEBHOOK_SECRET` to match the App's configured secret.
