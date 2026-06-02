---
applyTo: 'packages/github/**,**/server/github/**,**/webhooks/**'
---

# GitHub Integration Review Heuristics

GitHub is Tribunal's only integration. `@tribunal/github` holds the GitHub
logic (read caching, token/installation access, webhook parsing and storage),
and the SvelteKit web app consumes it from
`applications/web/src/lib/server/github/**` and the webhook route at
`applications/web/src/routes/api/webhooks/github/+server.ts`.

There is no workflow runtime. Webhook handlers persist events and invalidate
caches; orchestration dispatch has been removed, so a few paths log
`would dispatch ...` where a workflow signal used to fire.

## API read caching

- All GitHub API read operations in `packages/github/` must use the `cachedRead`
  abstraction from `@tribunal/github/core/github-read-client`.
- Register a `CachePolicy` in `packages/github/src/core/cache-policy.ts` for new
  endpoints. Prefer `requirePolicy(operationId)` over `getPolicy(operationId)!`
  at call sites for descriptive errors.
- Add invalidation handling in `packages/github/src/webhooks/resource-invalidation.ts`.
- Use `{ bypass: true }` only when fresh data is explicitly required (sync flows,
  write-then-read). Document the bypass reason.
- Never cache write operations (POST/PUT/PATCH/DELETE).
- Do not inline `getCached`/`setCache` calls — use `cachedRead`.

## Webhook handling

The route verifies, deduplicates, stores, then routes. Preserve that order.

- Verify the `x-hub-signature-256` signature **before** parsing or processing.
  Reject unverifiable payloads.
- Deduplicate by delivery ID (`x-github-delivery`) via `claimWebhookDelivery`
  **before** any non-idempotent operation. A failed claim means a duplicate —
  return early.
- Persist events with `storeWebhookEvent` before downstream side effects.
- Route typed events through `createGithubWebhookRouter` from
  `github-webhook-schemas/registry`; the router validates payloads against Zod
  schemas. Await the handler promise — the router does not await async handlers.
- Await critical side effects (persistence, cache invalidation) before returning.
  Only PR state tracking is intentionally fire-and-forget.

## Symmetric event handling

When using type guards instead of generic handlers, handle **both directions**
of bidirectional events so caches do not go stale on the removal path:

- `installation_repositories`: `added` / `removed`
- `repository`: `renamed` / `transferred` / `edited` (and privacy/archival
  metadata changes)

Missing the removal or demotion direction leaves stale cached access and
repository data.

## Security

- Prevent IDOR by resolving resources through the user's access scope (see
  `packages/github/src/installations/access.ts`); never expose internal IDs
  directly.
- Verify ownership/authorization before mutating GitHub resources.
- Use `Promise.allSettled` for non-critical secondary operations such as cache
  invalidation so one failure does not abort the rest.

## Testing

- Run package tests with `bun run test` inside `packages/github` (Vitest:
  `vitest run -c vitest.configuration.ts`).
- Type-check with `bun run check`; lint with `bun run lint`.
