# API

Tribunal exposes a deliberately small HTTP surface via native SvelteKit
`+server.ts` endpoints in `applications/web/src/routes/`. There are exactly two
API endpoints: a customer API key validity check and the GitHub webhook intake.
Everything else the application does is rendered through SvelteKit page routes
(log in with GitHub, install the GitHub App, browse repositories and their open
pull requests), not through a JSON API.

## Endpoints

| Endpoint               | Method | Description                                       |
| ---------------------- | ------ | ------------------------------------------------- |
| `/api/api-keys/check`  | GET    | Verify a customer API key and return its metadata |
| `/api/webhooks/github` | POST   | Receive and process GitHub App webhook deliveries |
| `/api/webhooks/github` | GET    | List registered webhooks for the configured App   |

## Authentication

Two authentication modes are supported:

1. **User sessions (browser).** Cookie-based auth populated by `hooks.server.ts`
   and exposed as `event.locals.user`. Used by every SvelteKit page route and by
   `GET /api/webhooks/github`.
2. **Customer API keys.** Sent as `Authorization: Bearer <key>` with the format
   `uak_<prefix>_<secret>`. A key authenticates _as its owning user_ — it does
   not narrow permissions. Validation (format, hash, revocation, expiration) and
   the owner-identity authorization contract live in
   [`documentation/api-keys-authorization.md`](./api-keys-authorization.md).

GitHub webhook deliveries are not authenticated by session or API key. They are
verified by HMAC signature against `GITHUB_APP_WEBHOOK_SECRET` (see below).

## GET `/api/api-keys/check`

Verify that a customer API key is valid and return non-sensitive metadata. This
is an authentication validity check, not an operation-authorization decision.

**Auth:** Customer API key in `Authorization: Bearer <key>`.

**Handler:** `applications/web/src/routes/api/api-keys/check/+server.ts`, backed by
`getUserApiKeyIdentity` from `$lib/server/api-keys/user-request-context`.

**Response codes:**

| Status | Meaning                                   |
| ------ | ----------------------------------------- |
| 200    | Key is valid; returns key metadata        |
| 401    | Missing, invalid, revoked, or unknown key |
| 500    | Server error while resolving the identity |

**200 response:**

```json
{ "ok": true, "key": { "id": 123, "userId": 456, "prefix": "uak_a1b2c3d4e5f6", "name": "My Key" } }
```

## POST `/api/webhooks/github`

Receive GitHub App webhook events, verify the signature, deduplicate deliveries,
store the event, and route it to the typed handlers.

**Auth:** GitHub webhook signature, verified with `GITHUB_APP_WEBHOOK_SECRET`. The
signature is checked _before_ any payload parsing. If the secret is not configured
the endpoint returns 500.

**Handler:** `applications/web/src/routes/api/webhooks/github/+server.ts`.

**Processing flow:**

1. Validate the request and extract the payload, signature, event type, and
   delivery ID.
2. Verify the HMAC signature (security gate — runs first).
3. Claim the delivery to deduplicate. Most events claim early; pull-request
   "orchestrator trigger" events defer claiming until after successful
   processing so GitHub will retry on transient (500) failures. A duplicate
   delivery returns `200 { ok: true, message: "Already processed" }`.
4. Persist the event via `storeWebhookEvent` when it carries a repository.
5. Route the payload through the typed router
   (`createGithubWebhookRouter` from `github-webhook-schemas`), which validates
   against Zod schemas and dispatches to the per-event handlers in
   `./handlers/*`. `issue_comment` and `pull_request_review_thread` are handled
   on a manual fallback path.
6. Invalidate affected GitHub access/resource caches and update pull-request
   state tracking.

> [!NOTE] No workflow runtime
> The handlers validate and store events, then `console.log` what they would have
> dispatched. Tribunal has no background workflow runtime — webhook handling is
> intentionally a logging-and-storage skeleton.

Handled event types include `pull_request`, `pull_request_review`,
`pull_request_review_comment`, `check_run`, `check_suite`, `installation`,
`installation_repositories`, `installation_target`, `github_app_authorization`,
`push`, `issue_comment`, and `pull_request_review_thread`.

A successful delivery returns `200 { ok: true }`.

## GET `/api/webhooks/github`

List the webhooks registered for the configured GitHub App.

**Auth:** User session (browser). Returns 401 without `event.locals.user`.

**Response codes:**

| Status | Meaning                                 |
| ------ | --------------------------------------- |
| 200    | Returns the registered webhook list     |
| 401    | No authenticated user session           |
| 400    | GitHub App is not configured            |
| 502    | Failed to fetch the registered webhooks |

## Error handling

- SvelteKit errors map to HTTP status codes and include a machine-readable `code`
  (for example `NOT_FOUND`, `UNAUTHORIZED`).
- All `/api/**` responses are normalized to JSON by the
  `respondWithJsonForApiEndpoints` hook
  (`applications/web/src/lib/utilities/json-response.ts`), which wraps errors in
  an `{ ok: false, error: { message, status, code } }` envelope.

## Rate limiting

Rate-limit policies live in
`applications/web/src/lib/server/rate-limit/policies.ts`:

- **strict:** 10 requests/minute (sensitive mutations, resource creation)
- **standard:** 100 requests/minute (other mutations)

Buckets are stored in an in-memory map shared across endpoints and pruned
periodically.

## Client usage

Use standard `fetch()` against the route endpoints. For example, to verify a
customer API key:

```typescript
const response = await fetch('/api/api-keys/check', {
  headers: { Authorization: `Bearer ${apiKey}` },
});

const { ok, key } = await response.json();
```
