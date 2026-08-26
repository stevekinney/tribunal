---
paths:
  - applications/web/src/routes/connect/**
  - applications/web/src/lib/server/auth/**
  - applications/web/src/hooks.server.ts
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

- **Not offering a capability is not refusing it.** A client controls the `scope` value it sends, so omitting a scope from registrations and the consent screen does not make it unobtainable. Reject any requested scope outside the supported set as `invalid_scope` at the authorize endpoint.
- **A refresh request may narrow a grant, never widen it.** "Granted exactly as requested" is safe at authorize, where a user is present and approving. On refresh there is no user, so an explicit `scope` must be a subset of what the refresh token already carries; anything outside it is `invalid_scope`.
- **A scope grants a capability, not an object.** Holding the scope says the user consented to the operation; it says nothing about whether a caller-supplied identifier belongs to them. Every reader on a path where the caller supplies an identifier must enforce ownership or an installation boundary itself.
- **Consent-screen copy is a security property**, not UX text, whenever it is specified as verbatim display strings. Understating a grant there means the user approved something narrower than what is issued.
- **Rejecting an attack and accepting one produce different evidence.** A replay or reuse log line usually records a *rejected* attempt, so it is the control working. Do not treat one as proof of compromise, and do not treat its absence as health: the defect that silently accepts may emit nothing.

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
