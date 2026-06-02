# GitHub API reference

Complete code examples and detailed patterns for Octokit, REST/GraphQL endpoints, rate limiting, pagination, error handling, and webhooks.

## GitHub App auth with Octokit

Use installation tokens for repo-level operations. Prefer `createAppAuth` with JWT to installation token; cache and refresh tokens. Never use PATs when an App is appropriate.

```ts
import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";

export function createInstallationOctokit(input: {
  appId: string;
  privateKeyPem: string;
  installationId: number;
}) {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: input.appId,
      privateKey: input.privateKeyPem,
      installationId: input.installationId,
    },
  });
}
```

## Paginate all list endpoints

GitHub REST endpoints default to `per_page: 30` (max 100). **Always paginate** when fetching reviews, check runs, comments, or any list that could exceed 100 items. Use a `while` loop that stops when `data.length < perPage`. For GraphQL, use `pageInfo { hasNextPage endCursor }` with cursor-based pagination.

Failing to paginate causes silent data loss -- e.g., the 101st review is ignored, leading to incorrect aggregate state.

## Minimize public module exports

Only export functions from `index.ts` barrel files if they are consumed outside the module. Internal helpers (e.g., query functions used only by sibling handler files) should remain unexported to avoid dead API surface.

## 404 error handling

When wrapping GitHub API calls, **return `null` for 404 errors** instead of throwing. This enables graceful degradation in the UI:

```typescript
// Service function that may not find a resource
export async function getResourceById(
  installationId: number,
  owner: string,
  repo: string,
  id: number,
): Promise<Resource | null> {
  const octokit = await getInstallationOctokit(installationId);
  if (!octokit) {
    throw new Error('GitHub App not configured');
  }

  try {
    const response = await octokit.rest.resources.get({ owner, repo, id });
    return normalizeResource(response.data);
  } catch (error) {
    // Return null for 404 (resource not found) - graceful degradation
    if (error instanceof Error && 'status' in error && error.status === 404) {
      return null;
    }
    throw error; // Re-throw other errors (rate limits, auth, server errors)
  }
}
```

This pattern allows load functions to check for null and display appropriate UI feedback rather than crashing with uncaught exceptions.

**When bypassing wrapper functions** (e.g., using `octokit.rest.pulls.get` directly instead of `getPullRequest`), you must replicate the 404 handling that the wrapper provides. Otherwise, deleted resources cause unhandled exceptions that can crash loops processing multiple items.

## Header normalization

HTTP headers are case-insensitive, but Octokit may preserve original header casing (e.g., `Retry-After` vs `retry-after`). Always use case-insensitive lookup from `errors.ts` when reading headers:

```typescript
import { getHeader } from '@tribunal/github/errors';

// WRONG: Case-sensitive lookup - fails if GitHub returns 'Retry-After'
const retryAfter = error.response?.headers?.['retry-after'];

// CORRECT: Case-insensitive lookup
const retryAfter = getHeader(error.response?.headers, 'retry-after');
```

**Why this matters**: Without case-insensitive lookup, 403 errors with title-cased `Retry-After` headers would be misclassified as `insufficient_permissions` instead of `rate_limited`, preventing appropriate retry behavior.

The `getHeader()` helper is exported from `@tribunal/github/errors` and handles both direct matches and case-insensitive fallback.

## Consolidate normalization functions

When normalizing GitHub API responses, **use a single normalization function** for related types if they share the same structure. GitHub's list and detail endpoints often return the same fields:

```typescript
// WRONG: Duplicate functions with identical logic
function normalizeIssue(issue: GitHubIssueListItem): Issue { ... }
function normalizeIssueDetail(issue: GitHubIssueDetail): Issue { ... }

// CORRECT: Single function accepting union type
function normalizeIssue(issue: GitHubIssueListItem | GitHubIssueDetail): Issue {
  return {
    number: issue.number,
    title: issue.title,
    // ...shared fields
  };
}
```

Check `@octokit/types` Endpoints types to verify field compatibility before consolidating.

## Error helper functions for server endpoints

GitHub service modules should export reusable error helpers (`isRateLimitError`, `isNotFoundError`) so server endpoints can handle errors consistently:

```typescript
// In service module (e.g., issues.ts, issue-comments.ts)
interface OctokitRequestError extends Error {
  status: number;
  response?: {
    data?: { message?: string };
    headers?: Record<string, string>;
  };
}

function isOctokitRequestError(error: unknown): error is OctokitRequestError {
  return (
    error instanceof Error &&
    'status' in error &&
    typeof (error as OctokitRequestError).status === 'number'
  );
}

export function isRateLimitError(error: unknown): boolean {
  if (!isOctokitRequestError(error)) return false;

  if (error.status === 429) return true;

  if (error.status === 403) {
    const message = error.response?.data?.message ?? '';
    const retryAfter = error.response?.headers?.['retry-after'];
    return Boolean(retryAfter) || message.toLowerCase().includes('rate limit');
  }

  return false;
}

export function isNotFoundError(error: unknown): boolean {
  return isOctokitRequestError(error) && error.status === 404;
}
```

Then in server endpoints, wrap GitHub API calls with consistent error mapping:

```typescript
// In +server.ts or +page.server.ts
try {
  return await issueService.listIssuesForRepository(...);
} catch (error) {
  if (issueService.isRateLimitError(error)) {
    return errorResponse(429, 'GitHub API rate limit exceeded', 'RATE_LIMITED');
  }
  if (issueService.isNotFoundError(error)) {
    return errorResponse(404, 'Repository not found on GitHub', 'NOT_FOUND');
  }
  return errorResponse(500, 'Failed to fetch from GitHub', 'INTERNAL_ERROR');
}
```

## Input validation for text fields

When accepting text input that will be sent to GitHub (comments, descriptions, etc.), **use `z.string().trim().min(1)`** to reject whitespace-only values at the API boundary:

```typescript
// WRONG: Allows whitespace-only strings like '   '
const commentInput = z.object({
  body: z.string().min(1).max(65536),
});

// CORRECT: Trims whitespace then validates length
const commentInput = z.object({
  body: z.string().trim().min(1).max(65536),
});
```

This prevents 500 errors when service-layer validation rejects empty trimmed content that passed the Zod schema.

## Comment size limits

GitHub enforces comment size using UTF-16 code units (`string.length`), while we use grapheme clusters for readability.

- Use `truncateForGitHub` defaults (recommended limit) unless a caller explicitly needs a different `maxLength`.
- Always enforce `hardLimit` by UTF-16 code units after truncation to avoid 422 validation errors on emoji-heavy content.
- When merging caller options, spread first and set `hardLimit` last so callers cannot exceed GitHub's limit.
- When assembling structured comments, include separator characters (like `\n\n`) in the length budget.

## Webhook idempotency vs retries

If a webhook delivery is claimed up front (for example via `tryClaimWebhookDelivery`), GitHub retries with the same delivery ID will be skipped as duplicates. In that case:

- Don't return 500 expecting a retry for transient errors.
- Post a user-facing failure comment and return 202 for timeout/unknown/transient failures.
- If true retries are required, move the claim after successful processing or store processing state separately.

### Deferred claiming with pre-filters

When deferring delivery claims for retry support, any pre-filter must match handler validation exactly. If the pre-filter is broader than the handler:

- The pre-filter skips early claiming (expecting the handler to claim)
- The handler rejects the event and returns early without claiming
- The delivery record is never claimed

**Fix**: Either make the pre-filter match handler logic exactly (case sensitivity, state checks), or have the handler claim delivery on all early-return paths.

### Case-sensitive matching in webhook filters

GitHub label names are user-defined and can have any case. When filtering webhook events by label name, use case-insensitive comparison to match the handler's validation logic:

```typescript
// WRONG: Misses "Needs-Review" -- handler uses toLowerCase()
if (label?.name === 'needs-review') { ... }

// CORRECT: Matches handler behavior
if (label?.name?.toLowerCase() === 'needs-review') { ... }
```

### NonRetryableError in webhook catch blocks

When a webhook handler's catch block returns 500 for all errors, permanent errors (`NonRetryableError`, `PermissionError`) get retried endlessly without user feedback. Handle them before the catch-all:

```typescript
} catch (error) {
  if (error instanceof NonRetryableError) {
    await claimDelivery(deliveryId, installationId);
    await postFailureComment(..., error.message);
    return json({ ok: false, error: 'non_retryable_error' }, { status: 202 });
  }
  // Transient errors -- return 500 for retry
  return json({ ok: false, error: 'internal_error' }, { status: 500 });
}
```

## Comprehensive error handling for mutations

GitHub mutations can return various error codes. Include all relevant checks, especially `isValidationError` for operations with limits:

```typescript
// Assign has a 10-assignee limit that returns 422 when exceeded
if (issueService.isValidationError(error)) {
  return errorResponse(400, 'Invalid request (issues are limited to 10 assignees)', 'VALIDATION_ERROR');
}
```

## Avoid dead exports

Don't export types that are only used internally. Grep the codebase before exporting to verify consumers exist.

## User OAuth for write operations

**Use user OAuth tokens (not installation tokens) for write operations** that should be attributed to the user.

## Avoid duplicate OAuth lookups

When handling GitHub user OAuth tokens, fetch the OAuth connection once per request and reuse it for diagnostics and scope parsing to avoid redundant database/cache lookups:

```typescript
const accessToken = await refreshGitHubTokenIfNeeded(userId);
const connection = await getOAuthConnection(userId, 'github');

if (!accessToken) {
  if (!connection) return { ok: false, error: 'no_token', message: '...' };
  // ...other error handling
}

const scopes = parseScopes(connection?.scope ?? null);
```

Use user OAuth tokens for:
- **Comment create/reply/update/delete**: Comments are authored by users. GitHub requires the authenticated user to be the author for update/delete operations.
- **Thread resolution**: Shows who resolved the thread in the GitHub UI.
- **Review submissions**: Attributed to the reviewer.

```typescript
// WRONG: Uses installation token - actions attributed to GitHub App bot
const installation = await resolveInstallationForRepository(repositoryId);
await reviewCommentService.createComment(installation.octokit, ...);

// CORRECT: Uses user OAuth - actions attributed to the user
const userOctokit = await userOAuthService.getUserOctokit(ctx.user.id);
if (!userOctokit.ok) {
  throw mapUserOAuthError(userOctokit);
}
await reviewCommentService.createComment(userOctokit.octokit, ...);
```

Use installation tokens for:
- **Read operations** (listing PRs, issues, comments)
- **Repository-level actions** (requesting reviewers, managing labels)
- **Bot-authored content** (automated comments, status checks)

## Never silently swallow errors in lookup functions

When a function performs a lookup and the result is used to determine subsequent actions, **propagate errors instead of returning null**:

```typescript
// WRONG: Silently swallows rate limits, network errors, etc.
async function findThreadIdForComment(...): Promise<{ threadId: string } | null> {
  try {
    // ...lookup logic
    return { threadId: '...' };
  } catch {
    return null; // Caller thinks "not found" but it was actually a rate limit
  }
}

// CORRECT: Return discriminated union with error info
type FindThreadResult =
  | { found: true; threadId: string }
  | { found: false; error: null }        // Genuinely not found
  | { found: false; error: LookupError }; // Lookup failed

async function findThreadIdForComment(...): Promise<FindThreadResult> {
  try {
    // ...lookup logic
    if (found) return { found: true, threadId: '...' };
    return { found: false, error: null };
  } catch (error) {
    if (isRateLimitError(error)) {
      return { found: false, error: { code: 'rate_limited', message: '...' } };
    }
    return { found: false, error: { code: 'lookup_failed', message: '...' } };
  }
}
```

This ensures callers can show accurate error messages (e.g., "Rate limit exceeded" vs "Comment not found").

## Prefer optimistic attempts for permission-based restrictions

When checking if an operation is allowed (e.g., branch protection, repo permissions), **prefer allowing the attempt** when you can't definitively determine the restriction:

```typescript
// WRONG: Block optimistically - causes false negatives
if (protection.restrictions) {
  return { allowed: false, reason: 'Push restrictions enabled' };
}

// CORRECT: Allow attempt - the actual operation will fail with a clear error if denied
if (protection.restrictions) {
  // Can't reliably determine if our app is in the allowed list
  // Let the actual push operation fail with a specific error if needed
}
return { allowed: true };
```

**Why this matters**: Repos often explicitly allow automation apps in push restrictions. Blocking without checking the allowed list produces false negatives for properly-configured repos.

## Cached reads with `cachedRead`

All GitHub API read operations must go through the `cachedRead` abstraction defined in `packages/github/src/core/github-read-client.ts`. This provides a single entry point that handles cache lookup, eTag conditional requests, fail-open on Redis errors, and structured logging.

### When to use `cachedRead` versus direct API calls

Use `cachedRead` for all read operations (GET requests, GraphQL queries) that return data which can be stale for a short period. Use direct API calls only for:
- Write operations (POST, PUT, PATCH, DELETE) — these must never be cached
- One-off reads inside write-then-read flows where you need the absolute latest state — pass `{ bypass: true }` instead

### Basic usage

```typescript
import { cachedRead } from '../core/github-read-client.js';
import { getPolicy } from '../core/cache-policy.js';

export async function getIssue(
  context: GithubServiceContext,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<NormalizedIssue | null> {
  const policy = getPolicy('get-issue')!;

  const fetchFunction = async (etag?: string) => {
    const octokit = await context.getInstallationOctokit(installationId);
    if (!octokit) throw new Error('GitHub App not configured');

    try {
      const response = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
        headers: etag ? { 'if-none-match': etag } : undefined,
      });

      return {
        data: normalizeIssue(response.data),
        etag: response.headers.etag,
      };
    } catch (error) {
      if (isNotModifiedError(error)) return { notModified: true as const };
      if (isNotFoundError(error)) return { data: null, etag: undefined };
      throw error;
    }
  };

  const { value } = await cachedRead(context.cache, policy, fetchFunction, [
    owner,
    repo,
    issueNumber,
  ]);

  return value;
}
```

### eTag conditional request pattern

REST endpoints that return an `etag` response header support conditional requests. When a cached entry has expired but carries an eTag, `cachedRead` passes it to the fetch function. The fetch function must:

1. Include the eTag as an `If-None-Match` request header
2. Detect 304 responses and return `{ notModified: true }`
3. On 200, return the data with the new eTag from response headers

```typescript
import { isNotModifiedError } from '@tribunal/github/errors';

const fetchFunction = async (etag?: string) => {
  try {
    const response = await octokit.rest.pulls.list({
      owner,
      repo,
      headers: etag ? { 'if-none-match': etag } : undefined,
      per_page: 100,
    });

    return {
      data: response.data.map(normalizePullRequest),
      etag: response.headers.etag,
    };
  } catch (error) {
    if (etag && isNotModifiedError(error)) {
      return { notModified: true as const };
    }
    throw error;
  }
};
```

The `isNotModifiedError` helper is exported from `@tribunal/github/errors` and checks for Octokit errors with status 304.

GraphQL endpoints do not support eTags. Set `supportsEtag: false` in the cache policy for GraphQL operations.

### How `cachedRead` handles 304 responses

When `cachedRead` receives `{ notModified: true }` from the fetch function:
- It refreshes the envelope timestamps (`fetchedAt`, `expiresAt`) using the policy TTL
- It stores the updated envelope back in Redis
- It returns the existing cached value with `source: 'conditional'`

This saves GitHub API quota since 304 responses do not count against the rate limit.

### Policy registration for new endpoints

Register a new `CachePolicy` in `packages/github/src/core/cache-policy.ts`:

```typescript
registerPolicy({
  operationId: 'get-widget',
  keyFactory: (owner: string, repo: string, widgetId: number) =>
    CACHE_KEYS.GITHUB_WIDGET_DETAIL(owner, repo, widgetId),
  ttlSeconds: GITHUB_RESPONSE_CACHE_TTL_SECONDS,
  supportsEtag: true, // true for REST, false for GraphQL
});
```

Each policy must specify:
- `operationId` — unique identifier used in logging and registry lookup
- `keyFactory` — builds the Redis cache key from operation arguments; use entries from `CACHE_KEYS` in `packages/cache/src/cache-keys.ts`
- `ttlSeconds` — time-to-live; use shared constants (`GITHUB_RESPONSE_CACHE_TTL_SECONDS`, `GITHUB_LIST_CACHE_TTL`) for consistency
- `supportsEtag` — whether the endpoint returns eTag headers (REST yes, GraphQL no)

After registering the policy, add webhook-driven invalidation in `packages/github/src/webhooks/resource-invalidation.ts` for the relevant event types.

### Bypass mode for sync and write-then-read patterns

Pass `{ bypass: true }` when you need guaranteed-fresh data:

```typescript
// Sync workflow: must reflect latest GitHub state
const { value } = await cachedRead(
  context.cache,
  policy,
  fetchFunction,
  keyArgs,
  { bypass: true }, // Skip cache, always call GitHub
);
```

Bypass mode still stores the fresh result in Redis, so subsequent non-bypass reads benefit from the updated cache. Always document the bypass reason with a code comment explaining why stale data is unacceptable.

### Fail-open behavior

`cachedRead` never crashes on Redis errors. If Redis is unreachable:
- Cache reads fail silently and fall through to the GitHub API call
- Cache writes fail silently after a successful API response
- The operation completes as if no cache existed

This ensures GitHub API availability is never blocked by Redis downtime.

## See also

- `{baseDir}/rules/github-api.md` (core directives)
- `github-integration-expert` agent (for specialized GitHub integration review)
