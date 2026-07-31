# API

Tribunal exposes a deliberately small HTTP surface via native SvelteKit
`+server.ts` endpoints in `applications/web/src/routes/`. The application is
primarily rendered through SvelteKit page routes: log in with GitHub, install
the GitHub App, browse repositories, and inspect open pull requests.

## Endpoints

| Endpoint               | Method | Description                                       |
| ---------------------- | ------ | ------------------------------------------------- |
| `/api/webhooks/github` | POST   | Receive and process GitHub App webhook deliveries |
| `/api/webhooks/github` | GET    | List registered webhooks for the configured App   |

## Authentication

Browser pages and `GET /api/webhooks/github` use cookie-based user sessions
populated by `hooks.server.ts` and exposed as `event.locals.user`.

GitHub webhook deliveries do not use browser sessions. They are verified by
HMAC signature against `GITHUB_APP_WEBHOOK_SECRET`.

## POST `/api/webhooks/github`

Receive GitHub App webhook events, verify the signature, deduplicate deliveries,
store the event, and route it to the typed handlers.

**Auth:** GitHub webhook signature, verified with `GITHUB_APP_WEBHOOK_SECRET`.
The signature is checked before any payload parsing. If the secret is not
configured the endpoint returns 500.

**Handler:** `applications/web/src/routes/api/webhooks/github/+server.ts`.

**Processing flow:**

1. Validate the request and extract the payload, signature, event type, and
   delivery ID.
2. Verify the HMAC signature.
3. Claim the delivery to deduplicate. Review-engine dispatch failures release
   the claim before returning 500 so GitHub can retry durable review-intent
   enqueue. A duplicate delivery returns `200 { ok: true, message: "Already processed" }`.
4. Persist the event via `storeWebhookEvent` when it carries a repository.
5. Route the payload through the typed router
   (`createGithubWebhookRouter` from `github-webhook-schemas`), which validates
   against Zod schemas and dispatches to per-event handlers in `./handlers/*`.
   `issue_comment` and `pull_request_review_thread` are handled on a manual
   fallback path.
6. Invalidate affected GitHub access and resource caches and update
   pull-request state tracking.

Handled event types include `pull_request`, `pull_request_review`,
`pull_request_review_comment`, `check_run`, `check_suite`, `installation`,
`installation_repositories`, `installation_target`, `github_app_authorization`,
`push`, `issue_comment`, and `pull_request_review_thread` — the typed-router and
manual-fallback dispatch paths, sourced from
`ROUTER_HANDLED_GITHUB_WEBHOOK_EVENT_TYPES` and
`MANUAL_FALLBACK_GITHUB_WEBHOOK_EVENT_TYPES` in
`applications/web/src/lib/server/github/webhooks/handled-event-types.ts`. The
GitHub App's webhook subscription drift check uses a broader baseline
(`HANDLED_GITHUB_WEBHOOK_EVENT_TYPES` in the same file) that also covers event
types with real but non-dispatched side effects, such as `repository` — see
"Subscribed events" in [`documentation/INTEGRATIONS.md`](./INTEGRATIONS.md) for
the full list.

A successful delivery returns `200 { ok: true }`.

## GET `/api/webhooks/github`

List the webhooks registered for the configured GitHub App.

**Auth:** User session (browser). Returns 401 without `event.locals.user`.

**Response codes:**

| Status | Meaning                             |
| ------ | ----------------------------------- |
| 200    | Returns the registered webhook list |
| 401    | No authenticated user session       |
| 400    | GitHub App is not configured        |
| 502    | Failed to fetch registered webhooks |

## Error Handling

- SvelteKit errors map to HTTP status codes and include a machine-readable
  `code` such as `NOT_FOUND` or `UNAUTHORIZED`.
- All `/api/**` responses are normalized to JSON by the
  `respondWithJsonForApiEndpoints` hook
  (`applications/web/src/lib/utilities/json-response.ts`), which wraps errors in
  an `{ ok: false, error: { message, status, code } }` envelope.

## Client Usage

Use standard `fetch()` against the route endpoints. Browser-only endpoints rely
on the current session cookie, and webhook deliveries rely on GitHub's signed
request headers.
