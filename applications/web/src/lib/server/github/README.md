# src/lib/server/github

GitHub App + OAuth integration: installation auth, user-attributed write
auth, repository access verification, and webhook event handling.

GitHub is Tribunal's only integration. There is no background runtime here —
webhook handlers update database records and log the work that previously
dispatched to a workflow engine, but no jobs are executed.

## Module Structure

| File                    | Purpose                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `github-application.ts` | Wires `@tribunal/github`'s App singleton to env config; exports `getInstallationOctokit`                   |
| `user-oauth.ts`         | User OAuth Octokit factory for write operations (token refresh + scope parsing)                            |
| `access.ts`             | GitHub-level repository access verification with conservative caching, SSO handling, and a circuit breaker |
| `webhooks/`             | Webhook request validation, signature verification, and local event handlers                               |

Most domain logic lives in the `@tribunal/github` package and is imported here.
This directory holds the SvelteKit-specific glue (env wiring, `@sveltejs/kit`
errors, and handler files).

## Authentication

Two kinds of GitHub credentials, picked by operation:

- **Installation token** (`getInstallationOctokit`) for app-authored reads and
  writes that should not be attributed to a person.
- **User OAuth token** (`getUserOctokit`) for write operations that should be
  attributed to the signed-in user. The factory refreshes expiring user-to-server
  tokens and returns a discriminated `UserOctokitResult` (`ok: true` with the
  Octokit client and parsed scopes, or `ok: false` with a typed error).

## Access Verification

`access.ts` verifies that a signed-in user can reach a repository through their
own GitHub credentials:

- `verifyGitHubRepositoryAccess()` checks that a user's personal OAuth token can
  reach a repository and returns a discriminated union — `{ allowed: true, visibility }`
  or `{ allowed: false, reason, message, ... }` with denial reasons (`no_token`,
  `invalid_token`, `insufficient_scope`, `sso_required`, `no_access`,
  `rate_limited`, `repository_blocked`, `account_suspended`) plus optional SSO URL
  and retry-after details.
- Results are cached conservatively (denials are never cached when scope is
  uncertain), with a short TTL for SSO denials and a circuit breaker to avoid
  hammering GitHub during rate limits.
- `invalidateGitHubAccessCache`, `invalidateAllAccessCacheForRepo`,
  `markGitHubTokenInvalid`, and `markGitHubTokensInvalidByProviderUserId` keep the
  cache and token state in sync after webhook or auth changes.

## Webhooks

`webhooks/index.ts` re-exports the webhook surface — types, field extraction, and
cache-invalidation helpers from `@tribunal/github/webhooks/*`, plus the local
request and handler modules.

- `webhooks/request.ts` — `validateRequest` (payload size limits + header
  extraction) and `verifySignature` (HMAC-SHA256 via
  `@tribunal/github/webhooks/verify-webhook-signature`). Both throw `@sveltejs/kit`
  errors on failure.
- `webhooks/handlers/installation.ts` — `installation.*` and
  `installation_repositories.*` events: upserts installation records, updates
  status (active/suspended), and removes repositories. It calls
  `enqueueInstallationSync` from `@tribunal/github/sync`, which currently logs the
  work that would have been enqueued and returns a `started` status — no job runs.
- `webhooks/handlers/authorization.ts` — `github_app_authorization.revoked`:
  marks the sender's GitHub tokens invalid and clears their access cache.
- `webhooks/handlers/index.ts` also re-exports `handleRepositoryMetadataEvents`
  from `@tribunal/github/webhooks/handlers/repository`.

### Webhook flow

```
request → validateRequest → verifySignature → type guard → handler → update DB records / log
```

The installation lifecycle helpers in `@tribunal/github/installations/lifecycle`
update installation and repository state on delete/suspend/unsuspend/removal.
Where the old runtime would have cancelled in-flight jobs, the helpers now log the
work that would have been cancelled instead.

## Error Handling

`verifyGitHubRepositoryAccess` and the user OAuth factory return typed results
rather than throwing for expected failures. Reserve thrown errors (via
`@sveltejs/kit`'s `error()`) for request-level webhook rejection.

## Related

- Webhook route: `src/routes/api/webhooks/github`
- Authentication and OAuth connections: `src/lib/server/auth/authentication.ts`
- GitHub domain package: `packages/github` (`@tribunal/github`)

## Related Rules

- `../../../../../../.claude/rules/github-api.md`
- `../../../../../../.claude/rules/webhooks.md`
