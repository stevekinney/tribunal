# Troubleshooting

Common issues and fixes for local development and runtime debugging.

Tribunal is a single SvelteKit application (`applications/web`) backed by shared packages
(`packages/*`). It has no background worker tier — everything runs inside the web server.

## Environment Issues

### "Database connection failed"

- Confirm `DATABASE_URL` is set and reachable.
- If your Postgres provider requires TLS, include `?sslmode=require` in the connection string.
- Run `bun run scripts/doctor.ts` to verify environment variables and database connectivity.

## Build Issues

### "Type errors after schema change"

- Run `bun run db:generate` to generate the migration from the Drizzle schema.
- Restart the TypeScript server (or your editor) to clear stale types.

To run the full pre-migration check after changing the schema, use
`bun run database:migration:prepare` (generates the migration, verifies migration
consistency, and runs `bun run check`).

## Runtime Issues

### "GitHub 403 errors"

Tribunal uses two GitHub layers: OAuth login for user identity and a GitHub App
installation for repository access and webhooks. A 403 usually means one of them is
misconfigured.

- Check the stored OAuth scopes in the `oauth_connection.scope` column.
- Confirm the GitHub App is installed on the organization or account that owns the repository.
- Confirm the user actually has access to the repository in GitHub.
- For org repos, verify SSO authorization requirements.

### "Webhook deliveries not appearing"

- Confirm the webhook secret matches; signature verification lives in
  `packages/github/src/webhooks/verify-webhook-signature.ts`.
- A failed signature check is rejected before the event is stored, so check the
  request signature first.
- Each delivery is claimed for idempotency before processing
  (`packages/github/src/webhooks/claim-delivery.ts`); a duplicate delivery ID is
  acknowledged but not reprocessed.

### "Webhook delivered but data didn't update"

Handlers run their work in-process — there is no background worker or queue.

- `pull_request`, `pull_request_review`, and `check_suite` events update stored PR
  state via `packages/github/src/webhooks/pr-state-dispatch.ts`. These run
  fire-and-forget after the webhook responds, and failures are logged (not surfaced
  in the response), so check server logs for `PR state:` errors.
- `repository` events (rename, transfer, default-branch change) update stored
  repository metadata in `packages/github/src/webhooks/handlers/repository.ts`.
- `push` events to a default branch update the stored commit SHA. Note the
  `[base-branch-update] would signal orchestrators` log line is a no-op placeholder;
  there is no downstream processing to trigger.
- Cache entries are invalidated by event in
  `packages/github/src/webhooks/resource-invalidation.ts`, so a stale read after a
  webhook usually means the relevant `CACHE_KEYS` entry was not invalidated.

### "Cache not invalidating"

- Confirm you used the correct `CACHE_KEYS` constant (`packages/cache/src/cache-keys.ts`).
- Ensure `depends()` identifiers in load functions match the corresponding `invalidate()` calls.

## Development Issues

### "Port already in use"

| Port | Service   | Fix                          |
| ---- | --------- | ---------------------------- |
| 5173 | SvelteKit | Kill the existing dev server |

## Related References

- Environment checks: `bun run scripts/doctor.ts`
- Database workflow: `documentation/DATABASE.md`
