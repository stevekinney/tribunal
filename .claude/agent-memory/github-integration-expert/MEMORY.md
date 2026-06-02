# GitHub Integration Expert Memory

## Key architectural patterns (confirmed)

- Fork detection uses `head.repo.id !== base.repo.id` (not `full_name` string comparison). This is the correct approach: it handles renamed repos and cross-org moves. The webhook `head.repo` can be null when the fork source is deleted.
- `computeRepositoryUri(owner, name)` returns `https://github.com/{owner}/{name}.git` — used for git clone URLs stored in `repository.uri`.
- Installation tokens are safe to reuse across repositories within the same installation. GitHub App installations are org/user scoped; one token covers all repos in that installation unless you request `repository_ids` scoping at mint time.
- Installation tokens expire after exactly 1 hour. The `InstallationToken` type in `packages/github/src/installations/tokens.ts` includes `expiresAt` for expiry tracking.

## Comment limits (verified in codebase)

- `GITHUB_COMMENT_HARD_LIMIT = 65_536` UTF-16 code units (not graphemes). Enforced in `packages/github/src/comment-truncation.ts`.
- `truncateForGitHub` exists and is production code. Default `maxLength = 5_000` (readability), enforced `hardLimit = 65_536`. The hard limit is UTF-16 code units to match GitHub's API behavior.
- The "~50 comment per review" soft limit claim is inaccurate: GitHub's documented limit is 3,000 review comment events per hour per installation, not 50/60 per single review call. The Create Review endpoint is not documented to have a per-request comment count limit; the 422 at ~60 is community-observed but not in official docs.

## Create Review API (POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews)

Correct fields for review creation:
- `commit_id` (optional, defaults to latest HEAD)
- `body` (optional string, review summary)
- `event` (required): `'APPROVE'`, `'REQUEST_CHANGES'`, `'COMMENT'` — `'COMMENT'` is correct for non-blocking advisory reviews
- `comments` array (optional): each comment has `path`, `position` OR `line`/`side`/`start_line`/`start_side`, `body`
- `pull_request: write` permission is required to post reviews

## Review comment field names

Correct field names for individual review comments:
- `path` (required)
- `position` (old-style: diff position number)
- `line` (new-style: file line number)
- `side` (`'LEFT'` | `'RIGHT'`)
- `start_line` (multi-line only)
- `start_side` (multi-line only)
- `body` (required)

## Webhook trigger events

`pull_request.synchronize` fires on force push. `pull_request.reopened` should be subscribed alongside `opened` and `synchronize` if the ticket says review runs on re-open. The codebase already handles `reopened` in the orchestrator event filter.

## Public repo git clone rate limits

Unauthenticated git clone of public repos is rate limited: ~60 requests/hour from a single IP. For CI/sandbox environments this can be a real concern if clones are frequent from the same egress IP. Using an installation token or a deploy key eliminates this.

## createGithubWebhookRouter usage pattern

`createGithubWebhookRouter` from `github-webhook-schemas/registry`:
- Router is callable: `router(payload)` — no `.dispatch()` method
- Route keys are camelCase: `pullRequest`, `checkRun`, `installation`
- Handler signature: `(event) => void | Promise<void>` — no context parameter
- Router does NOT await async handlers (calls `F.catch(J)` on the returned promise, but our closures return `undefined`, so `F instanceof Promise` is false)
- When no schema matches, router silently ignores (no error)
- Pattern for async handlers: capture promise in closure variable, await after synchronous `router(payload)` call

```typescript
function createWebhookDispatcher(context: WebhookContext) {
  let handlerPromise: Promise<void> | undefined;
  const router = createGithubWebhookRouter({
    pullRequest: (event) => { handlerPromise = handlePullRequestEvent(event, context); },
    // ...other handlers
  });
  return async (payload: unknown): Promise<void> => {
    router(payload);
    if (handlerPromise) await handlerPromise;
  };
}
```

## github-webhook-schemas/fixtures — DeepPartial merge behavior

- `createPullRequestClosedEvent({ installation: { id: 501 } })` produces `installation: { id: 501 }` only — the base fixture has `installation: undefined` for PR events, so you get only what you pass.
- For PR events, `installation` needs `{ id: number, node_id: string }` to pass Zod schema validation. Always include `node_id` when overriding `installation` in PR/check fixtures.
- For `check_suite`, `sender` in fixtures has many required fields. When spreading base event + overriding sender fields, use `sender: { ...baseEvent.sender, id: X, login: 'Y', type: 'Bot' }` instead of replacing the whole sender object.
- `createCheckSuiteCompletedEvent()` has `pull_requests: []` by default. PR stubs need: `{ id, number, url, head: { ref, sha, repo: { id, url, name } }, base: { ref, sha, repo: { id, url, name } } }`.

## Key file paths

- Webhook handler: `applications/web/src/routes/api/webhooks/github/+server.ts`
- Webhook handler modules: `applications/web/src/routes/api/webhooks/github/handlers/`
- Webhook event filter: `packages/github/src/webhooks/pull-request-event-filter.ts`
- Token minting: `packages/github/src/installations/tokens.ts`
- Comment truncation: `packages/github/src/comment-truncation.ts`
- Repository URI: `packages/github/src/application/repository-uri.ts`
- Review comments: `packages/github/src/pull-requests/reviews/comments.ts`
