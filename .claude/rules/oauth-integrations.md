---
paths:
  - applications/web/src/routes/connect/**
---

# GitHub connect flow patterns

Before editing paths in this rule, load `$github-integration-rules` and apply its constraints.

Scope: the two connect flows under `applications/web/src/routes/connect/github/`. The GitHub App **installation** flow (`connect/github`, `connect/github/callback`) binds an installation to a user. The GitHub OAuth **account** flow (`connect/github/account`, `connect/github/account/callback`) stores per-user API tokens in `oauth_connection`.

Sign-in itself is Neon Auth and is not covered here. For session handling, `returnTo` sanitization, and the Neon Auth bridge, see `authentication.md`.

## Credential handling

- **Encrypt tokens before storing.** `oauth_connection.accessToken` and `refreshToken` are encrypted at rest and the caller owns encryption and decryption. Never log or return a raw token.
- **No multi-statement transactions.** The `neon-http` driver has no `db.transaction()`. Check existence before upsert and clean up only rows the current request created. Where atomicity is required, express it as a single statement.
- **Reconnect is one atomic statement.** `upsertOAuthConnection` inserts with `onConflictDoUpdate` on `(userId, provider)`, writing `providerUserId`, both tokens, `expiresAt`, `scope`, and `status: 'active'` together. Do not split it into read-then-write, and do not add compensating status reverts — there is no window between the credential write and the status change to compensate for.
- **`accessToken` is non-null.** A connection row always carries a token; `status: 'invalid'` marks it unusable rather than absent. Do not write code that expects a row with cleared credentials.
- **Removal is `deleteOAuthConnection`**, which drops the whole row. There are no OAuth-owned resource relations to clean up, so a changed `providerUserId` is simply overwritten by the upsert.

## State and CSRF

- **Always set a state parameter.** The account flow uses `setOAuthStateCookie` from `$lib/server/auth/authentication`; the App installation flow sets `github_app_state` directly. Both are `httpOnly`, `sameSite: 'lax'`, `secure` outside development, and short-lived.
- **Validate state before acting on a callback**, and delete the cookie on every exit path including the denial path.
- **One documented exception**: GitHub omits state when a user edits repository access from an existing installation's settings page. That path (`setup_action === 'update'` with no stored state) is validated through live installation access instead. Do not widen this carve-out.

## Authorization

- **Verify ownership before mutating by external identifier.** An installation identifier or provider account identifier arriving in a callback is attacker-influenced. Confirm the authenticated user actually has access before binding anything to them.
- **Prefer `NOT_FOUND` over `FORBIDDEN`** when the caller should not learn that a resource exists.
- **Never expose internal identifiers, raw Zod errors, or database detail** in a user-facing message. Log the detail, return something friendly.

## Provider enums

- The provider list is `oauthProviderEnum` in `@tribunal/database` (`['github']`), and connection status is `oauthConnectionStatusEnum` (`['active', 'invalid']`). Import the enum values rather than duplicating either list.
- A separate, vestigial `authProviderEnum` exists for database type continuity. It is not the connection provider list; do not use it for new work.
- `oauth_connection` is unique on `(userId, provider)`. Adding a provider means extending the enum, not adding a parallel table.

## Validation

- **Fail explicitly when an external API returns an empty or default value** where a real one was required. Do not silently store a fallback.
- **Validate response structure before reading nested fields**, and check any `errors` array before assuming data is present.
