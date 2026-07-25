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

GitHub sends webhook events to `POST /api/webhooks/github` (`applications/web/src/routes/api/webhooks/github/+server.ts`). The ingress pipeline is intact end to end; handlers validate, claim, optionally store events, match configured repository event listeners, invalidate caches, update local records, and enqueue durable `review_intent` rows for the current review engine when an event is eligible. There is no Temporal or workers application handoff; review kicks use the current review-intent path, event-listener drains create queued webhook-handler runs opportunistically after storage, and installation sync dispatch depends on whether a Weft client is configured in the running process.

The request lifecycle:

1. **Validate and extract.** Parse headers and payload (`validateRequest`).
2. **Verify the signature first.** HMAC verification against `GITHUB_APP_WEBHOOK_SECRET` happens before any processing (`verifySignature`). An unconfigured secret returns `500`.
3. **Claim the delivery (deduplicate).** `claimWebhookDelivery` records the delivery ID before processing so retries and duplicate deliveries are skipped without repeating side effects. Review-engine dispatch failures release that claim before returning `500`, allowing GitHub redelivery to retry durable review-intent enqueue.
4. **Store the event and match listeners.** Events carrying a repository are persisted via `storeWebhookEvent` (from `@tribunal/github/webhooks/webhook-events`) for auditability, then matched against enabled repository event listeners. Matching persists `event_listener_delivery` rows before the typed-handler review-engine filters run; the later drain can create queued `tribunal_run`, `webhook_event_handler_run`, and `agent_run` rows even when no `review_intent` is created.
5. **Route to a typed handler.** A per-request router from `github-webhook-schemas/registry` validates the payload against Zod schemas and dispatches to the matching handler in `./handlers/`. `issue_comment` and `pull_request_review_thread` are routed through a manual fallback path.
6. **Invalidate caches and track state.** Access and resource caches are invalidated for events that change repository data, repository rename/transfer events are reconciled, and pull-request state tracking runs fire-and-forget.

### What the handlers actually do

The handlers live in `applications/web/src/routes/api/webhooks/github/handlers/` and cover installation lifecycle, installation repositories, pull requests, reviews, review comments, review threads, check runs, check suites, pushes, and authorization revocation.

Some call functions with names like `signalPullRequestEvent`, `signalPullRequestClosed`, and `signalManualReview` (from `@tribunal/github/pull-requests/state/workflow-signals`). Those functions now write idempotent `review_intent` rows only when the delivery is eligible: the event kind must be one the current review engine consumes, the repository must have enabled watchers, and `pull_request.opened`/`reopened`/`synchronize` events must not be draft-only noise. The consumed event kinds are `pull_request.opened`, `pull_request.reopened`, `pull_request.ready_for_review`, `pull_request.synchronize`, `pull_request.closed`, `check_run.completed`, `check_run.rerequested`, `check_run.requested_action` with Tribunal's re-review identifier, and `check_suite.completed`/`rerequested`. Review, review-comment, review-thread, issue-comment, and base-branch push events are parsed and logged or used for cache/state maintenance, but they do not create durable review-engine work today. Separately, any repository-scoped event in this table can create durable event-listener delivery and queued webhook-handler work when an enabled listener matches it.

Installation lifecycle events do perform real record maintenance — they upsert, update, suspend, unsuspend, delete, or deactivate installation and repository records — because those keep the flat data model consistent. Their repository-sync dispatch path is only live when the running process has a Weft client; in the documented web production topology without `WEFT_DATABASE_URL`, the dispatch attempt logs that no registered sync workflow is available and returns without handing work to a separate worker. GitHub issue #241 tracks the missing production dispatch path.

#### Non-check-suite handler trace

This trace was recorded from source and tests on 2026-07-25 while closing issue #205. It intentionally does not claim production execution evidence: this repository has no checked-in production delivery export, log excerpt, or `webhook_event` sample proving any row below has executed against a live GitHub delivery. The binary verdict below answers whether the handler is verified against real production payloads.

| Event type                    | On-disk handler                                                                                          | Payload and storage path                                                                                                                                                                                                                           | Downstream observable effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Current evidence against realistic payloads                                                                                                                                                                                                                                             | Production payload verdict                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pull_request`                | `applications/web/src/routes/api/webhooks/github/handlers/pull-request.server.ts`                        | Typed router validates the payload; repository deliveries write `webhook_event` through `storeWebhookEvent`, extracting `prNumber` and sometimes `githubCreatedAt`; every delivery is claimed in `github_webhook_delivery`.                        | Eligible `opened`, `reopened`, `ready_for_review`, `synchronize`, and `closed` events write idempotent `review_intent` rows for enabled watchers and kick the review engine when configured; only `opened`, `reopened`, and `synchronize` are skipped for draft pull requests. All actions also run repository metadata handling, cache invalidation, and fire-and-forget PR-state tracking.                                                                                                                     | Handler tests cover lifecycle dispatch and draft-skip behavior with mocks; `packages/github/src/pull-requests/state/workflow-signals.test.ts` proves durable intent writes and `no_watchers` skips; `packages/github/src/webhooks/extract.test.ts` uses schema fixtures for extraction. | No — source and tests exist, but no production delivery evidence is checked in. |
| `pull_request_review`         | `applications/web/src/routes/api/webhooks/github/handlers/pull-request-review.server.ts`                 | Typed router validates the payload; repository deliveries write `webhook_event`, extracting `prNumber`; every delivery is claimed.                                                                                                                 | `submitted` and `dismissed` call `signalPullRequestEvent`, but those event types currently map to no durable `review_intent`; cache invalidation and fire-and-forget review-state tracking still run.                                                                                                                                                                                                                                                                                                            | Handler tests cover submit/dismiss signaling with mocks; `packages/github/src/pull-requests/state/workflow-signals.test.ts` proves the event types are ignored by the durable-intent mapper; `packages/github/src/webhooks/pr-state-dispatch.test.ts` covers review-state dispatch.     | No — source and tests exist, but no production delivery evidence is checked in. |
| `pull_request_review_comment` | `applications/web/src/routes/api/webhooks/github/handlers/pull-request-review-comment.server.ts`         | Typed router validates the payload; repository deliveries write `webhook_event`, extracting `prNumber`; every delivery is claimed.                                                                                                                 | Human-authored `created`/`edited` and all `deleted` events call `signalPullRequestEvent`, but those event types currently map to no durable `review_intent`; pull request review-related caches are invalidated.                                                                                                                                                                                                                                                                                                 | Handler tests cover human/bot filtering and no-durable-intent behavior with mocks; resource invalidation tests cover review-related cache invalidation.                                                                                                                                 | No — source and tests exist, but no production delivery evidence is checked in. |
| `check_run`                   | `applications/web/src/routes/api/webhooks/github/handlers/check-run.server.ts`                           | Typed router validates the payload; repository deliveries write `webhook_event`, extracting `commitSha`, and can match event listeners before typed check-run handling ignores non-completed, non-Tribunal rerun noise; every delivery is claimed. | `completed` writes `commit_pushed` review intents for associated pull requests; `rerequested` and Tribunal `requested_action` write `manual` review intents; completed and rerun triggers kick the engine when durable work exists. Other `check_run` actions may still be stored and listener-delivered, but they do not enqueue review-engine work.                                                                                                                                                            | Handler and shared dispatch tests cover completed and rerun fanout with mocks; workflow-signal tests prove `check_completed` and `manual` intent writes; resource invalidation tests cover check cache invalidation.                                                                    | No — source and tests exist, but no production delivery evidence is checked in. |
| `installation`                | `applications/web/src/routes/api/webhooks/github/handlers/installation-lifecycle.server.ts`              | Typed router validates the payload; no top-level `repository` means the normal `webhook_event` storage path is skipped; every delivery is claimed.                                                                                                 | `created` with account data upserts the installation and attempts repository sync; `new_permissions_accepted` marks the installation active and attempts repository sync; `suspend` and `unsuspend` only update installation status; `deleted` cancels or tears down local installation and repository work before deleting the installation record. Production web containers without `WEFT_DATABASE_URL` only log the unavailable sync handoff. GitHub issue #241 tracks the missing production dispatch path. | Handler tests cover lifecycle updates and sync dispatch with mocked records; lifecycle package tests cover deletion, status, repository removal, and cancellation behavior.                                                                                                             | No — source and tests exist, but no production delivery evidence is checked in. |
| `installation_repositories`   | `applications/web/src/routes/api/webhooks/github/handlers/installation-repositories-lifecycle.server.ts` | Typed router validates the payload; no top-level `repository` means the normal `webhook_event` storage path is skipped; every delivery is claimed.                                                                                                 | `added` attempts repository sync but does not directly maintain installation repository state; `removed` marks known installation repository links inactive, invalidates caches, and attempts local/best-effort workflow cancellation. Production web containers without `WEFT_DATABASE_URL` only log the unavailable sync handoff and cannot cancel engine-owned orchestrators cross-service. GitHub issues #241 and #246 track those missing production paths.                                                 | Handler tests cover added/removed dispatch; access-invalidation tests use `github-webhook-schemas` fixtures for added/removed repository cache invalidation.                                                                                                                            | No — source and tests exist, but no production delivery evidence is checked in. |
| `installation_target`         | `applications/web/src/routes/api/webhooks/github/handlers/installation-target-lifecycle.server.ts`       | Typed router validates the payload; no top-level `repository` means the normal `webhook_event` storage path is skipped; every delivery is claimed.                                                                                                 | `renamed` only logs the old and new account login; it does not update `github_installation.account_login` or enqueue an installation sync.                                                                                                                                                                                                                                                                                                                                                                       | Handler tests cover the log-only behavior. No storage, mutation, or sync assertion proves the local installation row changes.                                                                                                                                                           | No — source and tests exist, but no production delivery evidence is checked in. |
| `github_app_authorization`    | `applications/web/src/routes/api/webhooks/github/handlers/authorization-lifecycle.server.ts`             | Typed router validates the payload; no top-level `repository` means the normal `webhook_event` storage path is skipped; every delivery is claimed with `installationId` set to `null`.                                                             | `revoked` marks matching GitHub OAuth tokens invalid by sender provider user id and clears affected access caches.                                                                                                                                                                                                                                                                                                                                                                                               | Handler tests cover token invalidation and cache failure logging with mocks.                                                                                                                                                                                                            | No — source and tests exist, but no production delivery evidence is checked in. |
| `push`                        | `applications/web/src/routes/api/webhooks/github/handlers/push-lifecycle.server.ts`                      | Typed router validates the payload; repository deliveries write `webhook_event`, extracting `ref` and `commitSha`, and can match event listeners; every delivery is claimed.                                                                       | Base-branch dispatch only updates the stored default-branch commit SHA for a tracked repository with a default branch when the push ref matches that branch and `after` is present; affected pull requests are logged only when an installation client resolves and open pull requests target that branch. Push resource cache invalidation clears branch-head cache only for `refs/heads/*` refs.                                                                                                               | Handler tests cover dispatch invocation with mocks; `packages/github/src/webhooks/pr-state-dispatch.test.ts` covers base-branch behavior with fixture payloads.                                                                                                                         | No — source and tests exist, but no production delivery evidence is checked in. |
| `issue_comment`               | `applications/web/src/routes/api/webhooks/github/handlers/issue-comment.server.ts`                       | Manual fallback validates known `created`/`edited`/`deleted` shapes with library guards; repository deliveries write `webhook_event`, extracting `issueNumber` and, for pull request comments, `prNumber`; every delivery is claimed.              | Pull request comments call `signalPullRequestEvent`, but issue-comment event types currently map to no durable `review_intent`; issue and pull request caches are invalidated.                                                                                                                                                                                                                                                                                                                                   | Handler tests cover PR-only filtering, bot filtering, and no-durable-intent behavior with mocks; extraction/resource-invalidation tests cover issue-comment fields with realistic fixture shapes.                                                                                       | No — source and tests exist, but no production delivery evidence is checked in. |
| `pull_request_review_thread`  | `applications/web/src/routes/api/webhooks/github/handlers/review-thread.server.ts`                       | Manual fallback validates `resolved`/`unresolved` shapes with library guards; repository deliveries write `webhook_event`, extracting `prNumber`; every delivery is claimed.                                                                       | Resolved/unresolved events call `signalPullRequestEvent`, but review-thread event types currently map to no durable `review_intent`; pull request review-related caches are invalidated.                                                                                                                                                                                                                                                                                                                         | Handler tests cover resolved/unresolved signaling and no-durable-intent behavior with mocks; extraction and resource-invalidation tests cover thread fields.                                                                                                                            | No — source and tests exist, but no production delivery evidence is checked in. |

Follow-up issue mapping:

- GitHub issue #237 tracks the `installation_target.renamed` log-only behavior.
- GitHub issue #238 tracks the review-activity handlers (`pull_request_review`, `pull_request_review_comment`, `issue_comment`, and `pull_request_review_thread`) that parse/cache/log events without enqueueing durable review work.
- GitHub issue #241 tracks the installation lifecycle sync handoff that logs unavailable production dispatch when `tribunal-web` runs without `WEFT_DATABASE_URL`.
- GitHub issue #246 tracks removed-repository workflow cancellation that cannot reach engine-owned orchestrators from production `tribunal-web`.

Storage-specific conclusions:

- `github_webhook_delivery.event_type` and `webhook_event.event_type` are unconstrained `text`; schema alone cannot prove which event types have ever arrived.
- Repository-scoped events share the same idempotent `storeWebhookEvent` path, including conflict-safe re-select by `deliveryId`.
- Repository-scoped event storage and listener matching happen before typed-handler review-engine filtering. A handler-level "ignored" result only means ignored by that typed review-engine path; matching event listeners can still create queued `webhook_event_handler` and `agent_run` work for the stored event.
- Installation and authorization lifecycle events are delivery-claimed but are not persisted into `webhook_event` because the route only stores payloads with a top-level `repository`.
- The evidence gap for realistic payload compatibility can be reduced by replaying sandboxed deliveries captured from GitHub; the production payload verdict can only change after a correlated production delivery and concrete database/cache/review-intent effect are recorded for that event type.

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
