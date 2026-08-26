# MCP consent-flow session binding

Decision document for **TRI-25** (graph node D2). Drafted for human approval, not self-approved. It covers exactly what the issue scopes: how `GET /oauth/authorize` identifies the logged-in user, and what the Tribunal equivalent of `oauth_authorization_transactions.sessionTokenHash` binds to. It does not design the rest of the authorize/approve/deny flow—that belongs to TRI-31, which should treat this document as an input.

## Why this is a decision, not a port

Protokit's session layer is a database-backed opaque bearer token: `createSession` mints 48 random bytes, stores its SHA-256 hash in `user_sessions`, and sets it as a cookie that stays valid (and revocable) until it expires or is explicitly revoked. `oauth_authorization_transactions.sessionTokenHash` is a copy of that same hash, checked again at approve/deny time so the transaction can only be completed by the exact browser session that created it, not merely by the same account.

Tribunal has no `user_sessions` table and no opaque bearer token. `applications/web/src/lib/server/auth/neon-session.ts` verifies a Neon Auth JWT on every request; there is no server-side session record to look up or revoke. The verification is cryptographic rather than a lookup, and it is not a network round trip per request either: `getRemoteJwks` builds the key set once per issuer via `createRemoteJWKSet` and reuses it from `remoteJwksCache`. Naming a "replacement column" only makes sense once it is settled which of these two identity models the consent flow binds to, and the two must not coexist—the issue calls that out directly as the failure mode to avoid, and it is also the practical failure mode: a second, parallel session table introduced only for this flow would be exactly the kind of drift `mcp-integration-orchestration.md`'s "decisions already made" section is trying to prevent.

## How `GET /oauth/authorize` identifies the user today

This is already decided by the locked project decision ("Identity: Neon Auth with GitHub as provider is the sole source... reuse `neon-session.ts`; do not port a second JWT validator") and by how `applications/web` is already wired, not something this document is choosing:

- `hooks.server.ts`'s `authHandle` runs on every request. It reads the `tribunal-neon-auth-token` cookie, and when present calls `validateNeonSessionFromToken`, which verifies the JWT's signature and claims against the cached JWKS for that issuer and looks up the mapped Tribunal user by `neonAuthUserId`. The result is written to `event.locals.user` (an `AuthenticatedApplicationUser`, keyed by Tribunal's integer `user.id`) and `event.locals.neonSession`.
- This re-verification happens fresh, per request, including on the consent form's POST back to approve or deny. There is no cached "is this session still good" flag anywhere; every hop cryptographically re-checks the token that is actually present on that request.
- When `event.locals.user` is null, the existing pattern (matching `sanitizeReturnTo` in `applications/web/src/lib/utilities/return-to.ts` and the `/login` route) is to redirect to `/login` with a return-to path back to the original request. `GET /oauth/authorize` should follow the same pattern rather than inventing a second sign-in redirect.

One open mechanical question for whoever wires this in TRI-31: Protokit's MCP mount runs through `createApplicationMount()`, and it is not yet confirmed here whether requests through that mount pass through `hooks.server.ts`'s `authHandle` the same way ordinary SvelteKit routes do, or whether the mount needs to call `validateNeonSessionFromToken` directly. That is an implementation detail for TRI-31, not a session-model decision, and does not change the conclusion below.

## Decision: bind to the Neon Auth JWT, not a new session table

Tribunal adopts Neon Auth JWT identity for the consent flow. It does not adopt Protokit's `user_sessions` table.

Reasons:

- The identity decision is already locked project-wide. Standing up `user_sessions` only for this one flow would run two session regimes side by side, which is the explicit failure mode the issue names, and it would mean the consent flow trusts a different, weaker signal (a stored, revocable-but-not-cryptographically-checked-per-request row) than every other authenticated route in the application, which re-verifies the JWT signature live on every request.
- Standing up `user_sessions` for real session management (list active sessions, revoke a session from another device) is a legitimate future feature, but it is a separate project with its own scope, not something to smuggle in as a side effect of wiring one OAuth consent screen.

### Why the replacement is not "hash the presented token"

The naive port would hash whatever string sits in the `tribunal-neon-auth-token` cookie at the moment the transaction is created, the direct analog of hashing Protokit's opaque bearer token. That is unsafe here, and is the central reason this needed a decision document rather than a straight port:

- The Neon Auth JWT is short-lived: `applications/web/src/lib/auth/neon-client.ts` documents Better Auth's JWT plugin minting a new 15-minute JWT on every `/get-session` call, and the client runs that refresh on a 5-minute interval (`neonSessionRefreshIntervalMs`), rewriting the `tribunal-neon-auth-token` cookie's value each time.
- Protokit's authorization transaction has a 10-minute time-to-live (`authorizationTransactionTimeToLiveMs`).
- A background refresh lands inside that 10-minute window on every single consent flow that takes more than 5 minutes, and can land inside it for a shorter one too, purely by timing. If the transaction's session binding were a hash of the literal cookie value, `consumeAuthorizationTransaction`'s exact-hash-equality check would reject the approve/deny request outright, even though the same person, in the same browser, on the same authenticated account, submitted it. That is a spurious rejection built into the design, not an edge case—porting `sessionTokenHash` literally would regress consent approval reliability, not just its threat model.

### A requirement this places on TRI-31: the consent page must keep its own JWT alive

The 5-minute refresh above is not ambient. `useNeonSessionRefresh` is started by exactly two callers—`routes/(authenticated)/+layout.svelte` and `routes/onboarding/+page.svelte`—and its own contract says every authenticated page must opt in. A consent page served through the hook-mounted application does not inherit either.

So the failure this section rules out for the _binding_ returns in a different form for the _session itself_: a JWT valid on the authorize GET can carry less than the transaction's 10-minute lifetime, expire while the form sits open, and leave the approve/deny POST reaching `authHandle` with no authenticated user. Binding to `userId` does not save that case, because there is no session at all by then.

TRI-31 must therefore either start the refresh on the consent page or renew the JWT some other way. Treat this as an explicit requirement, not an assumption that the existing client timer covers the flow. It does not.

### What the replacement column is

The replacement is the transaction row's `userId` column, already present in Protokit's schema for a different purpose (identifying whose consent this is, used for the `oauth_codes`/token issuance that follows). No new column is added.

Protokit's `WHERE` clause in `consumeAuthorizationTransaction` carries two separate identity predicates because Protokit has two separate identity entities: `userId` (the account, from `users`) and `sessionTokenHash` (the specific login instance, from `user_sessions`). Tribunal has one identity entity: the verified Neon Auth JWT resolves directly to a Tribunal `user.id`, with no intermediate session-instance record to bind separately. The two predicates collapse into one: the transaction's `userId` must equal the currently-verified `event.locals.user.id`.

This is not stored as a hash, because nothing secret-shaped backs it. `userId` is a plain integer foreign key into `user`, the same as Protokit's own `userId` column already is (Protokit hashes `sessionTokenHash` and `csrfTokenHash` because those values are themselves credentials whose plaintext must not sit in the database; `userId` in both systems is not a credential).

A second candidate was considered and rejected: a separate column storing `neonAuthUserId` (the JWT's `sub` claim) instead of the Tribunal integer `userId`. It was rejected because it is redundant once `userId` is already stored—`findMappedUser` maps `neonAuthUserId` to `user.id` one-to-one, so a second column carrying the same fact through a different key adds a column without adding an independent check.

### How single-consume `UPDATE ... RETURNING` semantics are preserved

Unchanged in shape, changed in one predicate. Protokit's atomic consume is a single `UPDATE ... SET consumedAt = now() WHERE transactionId = ? AND csrfTokenHash = ? AND userId = ? AND sessionTokenHash = ? AND consumedAt IS NULL AND expiresAt > now() RETURNING *`. The Tribunal version drops the `sessionTokenHash` equality and keeps everything else, including the already-present `userId` equality:

```
UPDATE oauth_authorization_transactions
SET consumed_at = now()
WHERE transaction_id = :transactionId
  AND csrf_token_hash = :csrfTokenHash
  AND user_id = :userId
  AND consumed_at IS NULL
  AND expires_at > now()
RETURNING *
```

`:userId` is `event.locals.user.id` from the current request's freshly re-verified JWT, not a value trusted from the submitted form. The single `UPDATE ... RETURNING` still makes every rejection reason (missing, wrong CSRF, expired, already consumed, wrong user) collapse into one atomic predicate, so there is still no window between checking and consuming for a concurrent request to race through.

`applications/web/src/lib/server/database/index.ts` builds on `@tribunal/database`'s `createDatabase`, and `.claude/rules/database.md` already states the same constraint Protokit's own code comments call out: `db.transaction()` is not supported with the neon-http driver Tribunal uses. So Protokit's `unconsumeAuthorizationTransaction` compensating-write pattern (best-effort, un-consume the transaction if the second insert that mints the authorization code fails after the first `UPDATE` succeeded) is not a Protokit quirk to leave behind—it is required here too, for the identical driver reason, and TRI-31 should port it as-is.

### Concrete deltas for TRI-31

- Drop `sessionToken` from `AuthorizationTransactionInput` and from `consumeAuthorizationTransaction`'s input type; nothing replaces it as a separate parameter, because `userId` already carries the check.
- Drop the `sessionTokenHash` column from the schema port entirely; do not add a same-shaped replacement column.
- Change the `consumeAuthorizationTransaction` `WHERE` clause as shown above.
- Protokit's `authorization-transaction.integration.test.ts` has a `rejects a cross-session consume attempt for the same user` test. Port its intent as a `rejects a cross-user consume attempt with the same transaction and CSRF token` test (already covered in Protokit by a separate case, so this may just mean keeping that one and dropping the cross-session one) rather than deleting the coverage outright—the accepted trade-off below should still be backed by a test proving what protection remains.

## What is explicitly ruled out

Running two session regimes side by side is ruled out. Concretely, that means:

- No `user_sessions` table, or equivalent, added solely to give the consent flow something to hash.
- No second, parallel "is this user logged in" check that reads differently from `event.locals.user`. Every part of the consent flow (the GET that renders the form, and the POST that approves or denies) must derive identity the same way the rest of the application already does, through `authHandle` and `validateNeonSessionFromToken`.
- If Tribunal later wants real session management (an active-sessions list, remote revoke), that is scoped as its own project, evaluated on its own merits, not backed into existence by this issue.

## Accepted trade-offs against Protokit's model

Two properties Protokit's design provides are not fully preserved, and both are accepted deliberately rather than silently dropped:

**Mid-window revocation.** Protokit can kill a session mid-consent by setting `revokedAt` on its `user_sessions` row; the next lookup fails immediately. A Neon Auth JWT cannot be revoked mid-flight—it remains valid until its own `exp` claim passes. This is bounded: the JWT's lifetime is 15 minutes and the authorization transaction's is 10, so the exposure window is small and already bounded by the same expiry that governs every other authenticated action in the application today, not something newly introduced here.

**Cross-session, same-account binding.** Protokit's `sessionTokenHash` check rejects an approve/deny submitted under a different login session than the one that created the transaction, even for the same account—genuine defense in depth, verified against a real Protokit test (`rejects a cross-session consume attempt for the same user`), on top of the CSRF token and the `userId` check. Tribunal's design loses this specific layer, because nothing in the verified JWT payload identifies a session instance (`verifyNeonAuthToken` extracts `sub`, `email`, `name`, `avatarUrl`, and `exp`; it never touches a session-id-shaped claim). What is not lost:

- The per-transaction `csrfToken` is a fresh 32-byte random value that only ever travels to the browser inside the rendered consent form's response body (confirmed by reading Protokit's `handleOauthAuthorizeGet`: the transaction is created and its `transactionId`/`csrfToken` are passed straight into the rendered `OauthAuthorizePage` component props, never appended to a redirect URL), so it does not leak through a `Referer` header or browser history the way a URL parameter would.
- Single-consume atomicity and the 10-minute transaction TTL are both unchanged.
- Every request, including the approve/deny POST, re-verifies the JWT's signature live against the JWKS through `authHandle` before any transaction logic runs at all—a stronger per-request validity check, in the sense of "was this credential cryptographically checked right now," than Protokit's stored-row lookup, which only confirms "not expired, not revoked" against state that could itself be stale between writes.

## SESSION_SIGNING_SECRET: no collision, and it is not actually in scope here

Checked directly, not assumed: Tribunal's web application has no `SESSION_SIGNING_SECRET`, no same-purpose secret under a different name, and no existing `_PREVIOUS`-style rotation-overlap mechanism for any secret. The two signing/encryption secrets that do exist serve unrelated purposes and do not collide:

- `ENCRYPTION_KEY`—AES key used by `applications/web/src/lib/server/encryption.ts` to encrypt OAuth connection tokens at rest (GitHub access/refresh tokens in `oauthConnection`), and separately by `packages/github/src/reviews/read-tokens.ts`. Encryption, not signing; no rotation-overlap variable.
- `PROXY_SIGNING_KEY`—HMAC key used by `applications/proxy` to sign and verify capability tokens for sandbox egress requests. A different application entirely, unrelated to browser sessions or OAuth consent.

### One near-identical name already occupies the configuration surface

`SESSION_SECRET` is set to the placeholder `'placeholder-secret-at-least-32-chars-long'` in two places—`.github/workflows/ci.yml:214` and `applications/web/playwright.config.ts:34`—and is read by no runtime code anywhere in the repository. It is dead test configuration.

That is not a functional collision, but it is a naming one, and it matters at the moment `SESSION_SIGNING_SECRET` is introduced: two apparent session secrets differing by one word, one of them inert, is exactly the shape that gets wired incorrectly in a deployment or a test harness. **Disposition: delete the stale `SESSION_SECRET` entries in whichever issue first introduces `SESSION_SIGNING_SECRET`**, rather than leaving both standing. Recorded here so that issue does not have to rediscover it.

Tribunal's existing state-changing, cookie-authenticated flow (the GitHub account-connect OAuth dance in `applications/web/src/routes/connect/github/`) does not use an HMAC-signed, secret-keyed CSRF token at all—it generates a random nonce, stores it in a short-lived `httpOnly` cookie, and compares it on return. There is no sitewide stateless-CSRF-via-signing-secret mechanism in this codebase to collide with today.

More precisely, `SESSION_SIGNING_SECRET` is not even a dependency of the code path this issue is deciding. Reading Protokit's own `csrf-protection.ts`: the OAuth authorize/approve/deny flow does not use it either—its one-time `csrfToken` is a random value stored hashed on the transaction row, exactly as this document's design keeps it. `SESSION_SIGNING_SECRET` in Protokit signs two other things: a stateless CSRF token for cookie-authenticated routes that have no server-side transaction of their own (used by things like sign-out), and the Google OAuth state cookie. The Google layer is deleted outright per the locked project decision, so that consumer does not port. The other consumer—a generic stateless-CSRF mechanism for cookie-authenticated routes without their own transaction row—may or may not be needed if a later issue ports MCP-adjacent routes shaped like that (for example, an OAuth client management page). That is out of this issue's scope; it is a boundary note for whichever issue owns those routes, not a decision this document is making. If it does turn out to be needed, `SESSION_SIGNING_SECRET` as a name is unclaimed in Tribunal today, so there is no rename or collision to resolve before then either.

Resolution: no collision exists, because Tribunal has nothing occupying that name or that role, and the one consumer in scope for this issue (the consent-flow CSRF token) never depended on it in Protokit either.

## Open question

Does Neon Auth's Better Auth JWT plugin support emitting a stable session-instance claim (something like `sid`, distinct from `sub`) that survives the 5-minute refresh but still identifies one login instance rather than the whole account? If yes, a future revision could restore the cross-session-same-account defense in depth by binding to that claim instead of `userId` alone, without reintroducing a session table. This is genuinely unknown from this codebase: `verifyNeonAuthToken` does not currently read any such claim, and whether the underlying token even carries one has not been checked against Neon Auth's own configuration or documentation.

**The primary decision does not depend on the answer. The binding target might, and the approver should treat those separately.**

Choosing the Neon Auth JWT over a `user_sessions` table holds either way: the alternative is a second session regime, which is ruled out on its own merits.

But binding to `userId` _alone_ is a real reduction against Protokit, which bound to one browser session and so refused an approval submitted from a different session on the same account. If the token does carry a refresh-stable per-login claim, TRI-31 could extend `verifyNeonAuthToken` to expose it and bind to that, recovering the protection with no session table and no rotation-failure problem. "Today's validator does not read the claim" is not a reason to dismiss that—it is a modifiable implementation detail, and citing it as though it settled the question was the weak step in the original draft.

What would resolve it: inspect an actual minted token, or check Better Auth's JWT plugin configuration for a session-instance claim. That was not done here and cannot be answered from this repository alone. **If the approver wants the cross-session protection preserved, this should be resolved before TRI-31 rather than after.**
