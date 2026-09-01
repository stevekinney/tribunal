---
paths:
  - packages/mcp/src/**
---

# MCP authorization server rules

Tribunal's MCP surface is an OAuth 2.1 authorization server issuing tokens to third-party clients. These requirements are about that server, and are deliberately separate from `oauth-integrations.md`, which governs Tribunal acting as an OAuth *client* against GitHub. The two share a protocol and almost nothing else: credential storage, callback cookies, and provider enums there are specific to `oauth_connection` and do not apply here.

## Scope enforcement

- **Not offering a capability is not refusing it.** A client controls the `scope` value it sends, so omitting a scope from client registrations and the consent screen does not make it unobtainable. Reject any requested scope outside `getSupportedScopes()` as `invalid_scope` at the authorize endpoint. This is also what keeps conformance-only scopes unobtainable, as a consequence of the mechanism rather than a second list to maintain.
- **A refresh request may narrow a grant, never widen it.** "Granted exactly as requested" is safe at authorize, where a user is present and approving. On refresh there is no user, so an explicit `scope` must be a subset of what the refresh token already carries; anything outside it is `invalid_scope`. An omitted `scope` on refresh keeps the existing grant rather than reapplying the default.
- **A primitive returns data from exactly one capability family.** `requiredScope` is a single scope. A cross-domain primitive is split, never gated on whichever scope seems more sensitive — nothing in the vocabulary makes one scope imply another, so that returns data governed by a scope the user may have declined.

## Object-level authorization

- **A scope grants a capability, not an object.** Holding the scope proves the user consented to the operation; it proves nothing about whether a caller-supplied identifier belongs to them. Every reader on a path where the caller supplies an identifier must enforce ownership or an installation boundary itself.
- Function names imply access control they may not implement. Check the reader, not the name.

## Consent

- **Consent-screen copy is a security property**, not UX text, wherever it is specified as verbatim display strings. Understating a grant there means the user approved something narrower than what is issued.

## Untrusted content

- Any tool returning externally authored content crosses a prompt-injection boundary. Pull request bodies, diffs, and comments are author-controlled; repository and branch names are administrator-controlled and are *not* exempt merely because access is installation-gated. Frame such output as data, not instructions.
- Any tool fetching a user-supplied or client-supplied URL must reuse `assertHostnameIsPubliclyRoutable`.

## Detection evidence

- **Rejecting an attack and accepting one produce different evidence.** A replay or reuse log line usually records a *rejected* attempt, so it is the control working. Do not treat one as proof of compromise, and do not treat its absence as health: the defect that silently accepts may emit nothing at all.
