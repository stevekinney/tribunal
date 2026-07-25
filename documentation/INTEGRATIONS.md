# Integrations

Tribunal has exactly one product integration: **GitHub**. There is no Linear,
Notion, Slack, Google Drive, or any other provider. Authentication is managed by
**Neon Auth** with GitHub as the only sign-in provider. Keep these roles separate:

- **Identity and sessions** come from managed Neon Auth.
- **Repository authorization** comes from a Tribunal-owned encrypted GitHub OAuth
  connection stored in `oauth_connection`.
- **Repository access and webhooks** come from a GitHub App installation. After
  signing in, you install the Tribunal GitHub App into the organizations and
  accounts whose repositories you want to see.

The surviving user flow is short: sign in through Neon Auth with GitHub, connect
the GitHub account for repository authorization, install the GitHub App, browse
repositories, and view open pull requests for those repositories.

## Authentication: Managed Neon Auth

Neon Auth establishes _who you are_. Tribunal does not self-host Better Auth
tables. The browser signs in through the Neon Auth client and the server verifies
a Neon JWT from a bridge cookie.

- `/login` renders a Svelte sign-in button that calls
  `authClient.signIn.social({ provider: 'github', callbackURL })` from
  `@neondatabase/neon-js/auth`.
- `/auth/callback` retrieves a Neon JWT with `authClient.token()`, posts it to
  `/api/auth/neon-session`, then redirects to the sanitized `returnTo`.
- `/api/auth/neon-session` verifies the JWT against
  `${NEON_AUTH_BASE_URL}/.well-known/jwks.json`, checks issuer/audience, upserts
  the Tribunal profile row, and sets `tribunal-neon-auth-token`.
- `hooks.server.ts` verifies the bridge cookie and populates `event.locals.user`
  plus `event.locals.neonSession`.

Relevant environment variables: `PUBLIC_NEON_AUTH_URL`, `NEON_AUTH_BASE_URL`.

## Repository authorization: GitHub OAuth connection

Tribunal still needs a GitHub OAuth token because Neon Auth identity tokens are
not GitHub API authorization. This flow lives in
`applications/web/src/routes/connect/github/account/`.

- `GET /connect/github/account` requires a valid Neon-backed session, creates
  CSRF state, and redirects to GitHub OAuth for `repo,user:email`.
- `GET /connect/github/account/callback` validates state, exchanges the code,
  fetches the GitHub user, and stores encrypted access/refresh tokens in
  `oauth_connection`.

Relevant environment variables: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`GITHUB_REDIRECT_URI`.

## Repository access: GitHub App installation

The OAuth login does not grant access to any repository contents. That requires installing the GitHub App. The flow lives in `applications/web/src/routes/connect/github/`.

- `GET /connect/github` (`+server.ts`) requires a logged-in user and an active
  GitHub OAuth connection. Without that connection, it redirects to
  `/connect/github/account?returnTo=/connect/github`. With it, the route
  generates install state for CSRF protection and callback binding, sets the
  `github_app_state` cookie, and redirects to
  `https://github.com/apps/${GITHUB_APP_NAME}/installations/new`.
- `GET /connect/github/callback` (`+server.ts`) binds the resulting installation to the logged-in Tribunal user and persists the installation record.

The installation is what produces an installation access token, which the server uses to read repositories and pull requests on your behalf.

Relevant environment variables: `GITHUB_APP_ID`, `GITHUB_APP_NAME`, `GITHUB_APP_PRIVATE_KEY`.

## Webhooks

GitHub sends webhook events to `POST /api/webhooks/github` (`applications/web/src/routes/api/webhooks/github/+server.ts`). The ingress pipeline is intact end to end; what it does _not_ do anymore is hand off to any background worker or workflow runtime. There is no Temporal and no workers application. Handlers persist data, invalidate caches, and log what _would_ have been dispatched.

The request lifecycle:

1. **Validate and extract.** Parse headers and payload (`validateRequest`).
2. **Verify the signature first.** HMAC verification against `GITHUB_APP_WEBHOOK_SECRET` happens before any processing (`verifySignature`). An unconfigured secret returns `500`.
3. **Claim the delivery (deduplicate).** `claimWebhookDelivery` records the delivery ID before processing so retries and duplicate deliveries are skipped without repeating side effects. Review-engine dispatch failures release that claim before returning `500`, allowing GitHub redelivery to retry durable review-intent enqueue.
4. **Store the event.** Events carrying a repository are persisted via `storeWebhookEvent` (from `@tribunal/github/webhooks/webhook-events`) for auditability.
5. **Route to a typed handler.** A per-request router from `github-webhook-schemas/registry` validates the payload against Zod schemas and dispatches to the matching handler in `./handlers/`. `issue_comment` and `pull_request_review_thread` are routed through a manual fallback path.
6. **Invalidate caches and track state.** Access and resource caches are invalidated for events that change repository data, repository rename/transfer events are reconciled, and pull-request state tracking runs fire-and-forget.

### What the handlers actually do

The handlers live in `applications/web/src/routes/api/webhooks/github/handlers/` and cover installation lifecycle, installation repositories, pull requests, reviews, review comments, review threads, check runs, check suites, pushes, and authorization revocation.

Some still call functions with names like `signalPullRequestEvent` and `signalPullRequestClosed` (from `@tribunal/github/pull-requests/state/workflow-signals`). These are **stubs**: the workflow dispatch they once drove has been removed, and they now `console.log` the signal that would have been sent and return success so existing call sites keep compiling. The `+server.ts` ingress likewise logs `[webhook] would dispatch pull-request-review workflow` instead of dispatching anything. Treat these as no-ops, not live orchestration.

Installation lifecycle events do perform real work — they upsert or update installation records and enqueue repository sync — because those keep the flat data model consistent.

### Subscribed events

The GitHub App's webhook event subscription is **tracked configuration, not code** — it lives entirely in the App's settings on GitHub (Settings → Developer settings → GitHub Apps → your App → Permissions & events), and nothing in this repository can change it. Getting it right (and keeping it right) is a manual step, so it needs a paper trail here.

**Expected subscription.** Tribunal has real, code-level behavior tied to exactly these 19 event types — see `applications/web/src/lib/server/github/webhooks/handled-event-types.ts`, the single source of truth the ingress route, the drift check, and this list all derive from:

Dispatched through a typed handler or the manual-fallback path in `+server.ts`:

- `check_run`
- `check_suite`
- `github_app_authorization` \*
- `installation` \*
- `installation_repositories` \*
- `installation_target`
- `issue_comment`
- `pull_request`
- `pull_request_review`
- `pull_request_review_comment`
- `pull_request_review_thread`
- `push`

No dedicated per-type handler, but reached unconditionally on every request via repository-metadata sync, access/resource cache invalidation, or webhook-event storage — a missing subscription here is a real functional gap, just a quieter one:

- `repository` (rename/transfer/edit — the only path that keeps stored repository owner, name, and default branch in sync for an already-installed repository)
- `member`, `team`, `organization`, `membership` (repository access-cache invalidation)
- `issues` (audit storage and cache invalidation, same as `issue_comment`)
- `status` (CI-status cache invalidation, same as `check_run`/`check_suite`)

\* Non-configurable — GitHub delivers these three regardless of the App's subscription settings, so they never need to be (and cannot be) toggled on. The other sixteen must be explicitly checked in the App's webhook event list.

**Catalog vs. subscription — do not confuse these.** `packages/github/src/webhooks/registered-webhooks.ts` also exports `SUPPORTED_GITHUB_WEBHOOK_EVENT_CATALOG` (every event type `@octokit/webhooks` knows about) and `CONFIGURABLE_GITHUB_WEBHOOK_EVENT_CATALOG` (that catalog minus the three non-configurable events above). Those describe everything GitHub _could_ send — dozens of event types Tribunal has no handler for and has no reason to subscribe to. The expected-subscription list above, not the catalog, is the drift baseline. `installation_target` in particular is deliberately treated as a normal, configurable event here (not grouped with the three non-configurable ones): GitHub's webhook documentation states plainly, for each of `installation`/`installation_repositories`/`github_app_authorization`, that "All GitHub Apps receive this event by default. You cannot manually subscribe to this event" — `installation_target`'s entry has no such language, only a generic app-availability tag, meaning it must be explicitly checked like any other event.

**Drift detection.** `applications/web/src/lib/server/github/webhooks/subscription-drift.ts` diffs the App's live subscription (`getRegisteredWebhooks`, via `GET /api/webhooks/github`) against the expected-subscription list above, excluding the three non-configurable events so they're never reported as false positives. Every read on this confirmation path bypasses the Redis cache (`{ bypass: true }`) — the underlying `get-app-webhook-configuration` cache policy has a 24-hour TTL, and a cached read here would keep reporting an already-fixed subscription as still drifted for up to a day. Two things consume the diff:

- **A startup warning.** `hooks.server.ts` runs the check once via SvelteKit's `init` server hook and logs a `console.warn` (never fatal — this is an operational signal, not a security gate) listing any handled event type the App is not subscribed to. Check the web application's logs after a deploy.
- **The `/webhooks` page.** When drift exists, the page shows a banner naming the missing event types. It also splits the "Subscribed events" summary into events that have ever been received versus events the App is subscribed to but that have never arrived — those are different situations that otherwise look identical (a quiet integration vs. one where GitHub simply never learned to send that event type). "Received at least once" is an unbounded, all-time check, not a recent-activity signal — an event type can stay in that group long after deliveries have actually stopped arriving.

**If you change the App's webhook subscription in production:**

1. In the GitHub App settings, check every event type listed above under "Subscribe to events" (the three non-configurable ones cannot be unchecked and do not appear in that list).
2. Save. GitHub applies the new subscription immediately; no redeploy is required.
3. Confirm the fix: `GET /api/webhooks/github` (authenticated) returns `{ registered, unregistered }` — `registered` should now include the event types you just added, immediately (this endpoint bypasses the cache). `/webhooks` should stop showing the drift banner, and new event types should start appearing in the "Event type" filter and in the `webhook_event` table as GitHub sends real traffic.
4. If a newly-subscribed event type starts failing with `403`s once traffic resumes, that is a **separate** problem: a missing GitHub App **permission**, not a missing event subscription. Permissions and event subscriptions are configured independently in the same settings page — check the "Permissions" tab for the resource the new event type covers (for example, `pull_request_review_thread` requires the "Pull requests" repository permission, and `repository`/`member`/`team`/`organization`/`membership` require the corresponding organization or repository administration permissions).

## Data model produced by these integrations

GitHub is the only source of records, and the model is intentionally flat (schema in `packages/database/src/schema/`):

```
user
  └─ github_installation                  (GitHub App install, bound to a user)
       └─ github_installation_repository  (join: which repos this install covers)
            └─ repository                  (repo identity persisted from GitHub)
```

Pull requests are **not** stored: they are read live from the GitHub API at
render time for the repositories an installation covers. Supporting tables
include the Tribunal user profile, encrypted GitHub OAuth connections, user API
keys, and the webhook audit tables (`webhook_event`, `github_webhook_delivery`).
There are no workspaces, projects, agents, or any other higher-level constructs.

## Caching rule

All GitHub API _read_ operations in `packages/github/` go through the `cachedRead` abstraction (`@tribunal/github/core/github-read-client`) with a registered cache policy. See `.claude/rules/github-api.md` for the required pattern, when to bypass the cache, and how to register a new cached endpoint.

## Local verification

```bash
bun install
bun run test            # package + app test suites
bun run db:migrate      # apply Drizzle migrations to your database
```

To exercise webhooks locally, expose your dev server with a tunnel, point the GitHub App's webhook URL at `<tunnel>/api/webhooks/github`, and set `GITHUB_APP_WEBHOOK_SECRET` to match the App's configured secret.
