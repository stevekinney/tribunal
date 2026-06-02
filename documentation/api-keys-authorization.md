# Customer API Key Authorization

This document describes how customer API keys authenticate in Tribunal and what
they currently authorize.

## Summary

Tribunal is intentionally minimal: the only integration is GitHub, and the data
model is flat (`user` → `github_installation` → `installation_repository` →
`repository` → `pull_request`). There are no workspaces, projects, memberships,
or roles. As a result, customer API keys do very little today:

- A key authenticates **as the owning user identity** (`userId`, plus key
  metadata).
- The key record does **not** narrow permissions. There are no per-key scopes.
- There is no permission/role guard layer to evaluate. The flat model has no
  membership concept to authorize against.

The single endpoint that consumes key authentication today is
`/api/api-keys/check`, which is an authentication **validity** check, not an
operation authorization decision.

## Implementation mapping

- **Authentication:**
  `applications/web/src/lib/server/api-keys/user-auth.ts` validates the key
  format, looks the row up by prefix, checks revocation and expiration, verifies
  the hash (timing-safe), and returns owner identity
  (`UserApiKeyIdentity`: `userId`, `userApiKeyId`, `prefix`, `name`).
- **Request-level helper:**
  `applications/web/src/lib/server/api-keys/user-request-context.ts` composes
  `parseBearerToken` + `authenticateUserApiKey` into a single
  `getUserApiKeyIdentity(event)` call. It is a thin wrapper that returns the
  authenticated identity; it does **not** resolve or narrow permissions.
- **Schema:** `packages/database/src/schema/user-api-key.ts` defines the
  `user_api_key` table. There is no `scopes` column. Lifecycle columns are
  `expiresAt` and `revokedAt`. The `userId` foreign key has
  `onDelete: 'cascade'`.
- **Key management UI/actions:**
  `applications/web/src/routes/(authenticated)/api-keys/+page.server.ts` lists,
  creates, rotates, and revokes keys via
  `applications/web/src/lib/server/api-keys/user-api-key-service.ts`.

## Authentication results

`authenticateUserApiKey` returns a discriminated union. Failure reasons are:

- `missing_header` — no `Authorization` header present.
- `invalid_format` — header present but not in `Bearer <token>` form.
- `invalid_key` — bad prefix format, or the hash did not verify.
- `unknown_key` — no key row matched the prefix.
- `revoked_key` — key was explicitly revoked, **or** has expired (see below).
- `server_error` — the database query failed; the endpoint should respond `500`.

The `/api/api-keys/check` endpoint maps `server_error` to `500` and every other
failure to `401`.

## Key lifecycle edge cases

### User deleted

The `userId` foreign key on `user_api_key` has `onDelete: 'cascade'`, so deleting
the user row deletes the key row. A subsequent prefix lookup returns no row and
authentication fails with `unknown_key` (`401`).

### Key expired mid-request

`expiresAt` is checked once, during authentication. Once authentication
succeeds, the request runs to completion regardless of clock drift. Expiration is
a coarse lifecycle control, not a millisecond-precise boundary.

Expired keys currently return `revoked_key` — the **same** reason code as
explicitly revoked keys. This is intentional: callers cannot distinguish an
expired key from a revoked one, which avoids leaking key state. A distinct
`expired_key` reason is a possible future refinement.

### User deactivation

There is no `isActive` or `disabled` column on the `user` table, so there is no
concept of a deactivated user. (The table does have `isPlatformAdministrator`,
but that is unrelated to API key validity.) If a deactivation column is added
later, `user-auth.ts` would need to check active status after hash verification
and return a dedicated failure reason.

## Future scopes (not implemented)

Per-key scopes do not exist. The `UserApiKeyIdentity` interface
(`user-auth.ts`) carries an inline note describing how scopes might work later:
if added, the identity would also expose key scope data so the request-context
helper could intersect user permissions with key scopes
(`effective = user permissions INTERSECT key scopes`).

This is a future possibility, not a contract. Designing it would first require a
permission model to intersect against — which the current flat, GitHub-only data
model does not have. There is no schema, runtime behavior, or guard layer for
scopes today.

## Verification

```bash
# From applications/web — run the API key auth and endpoint tests
bun run test:unit:server

# Type-check the web app
bun run check
```

Relevant test files:

- `applications/web/src/lib/server/api-keys/user-auth.test.ts`
- `applications/web/src/lib/server/api-keys/user-api-key-service.test.ts`
- `applications/web/src/lib/server/api-keys/user-api-key.integration.test.ts`
- `applications/web/src/routes/api/api-keys/check/server.test.ts`
