# GitHub API caching rules

Before editing paths in this rule, load `$github-integration-rules` and apply its constraints.

All GitHub API read operations in `packages/github/` must use the `cachedRead` abstraction from `@tribunal/github/core/github-read-client`.

## Required pattern

```typescript
import { cachedRead } from '../core/github-read-client.js';
import { getPolicy } from '../core/cache-policy.js';

const policy = getPolicy('operation-id')!;
const { value } = await cachedRead(context.cache, policy, fetchFunction, keyArgs);
```

## When to bypass

Use `{ bypass: true }` only when fresh data is explicitly required:
- Sync workflows that must reflect latest GitHub state
- Write-then-read patterns where stale data would be incorrect

Document the bypass reason in a code comment.

## Adding new cached endpoints

1. Register a `CachePolicy` in `packages/github/src/core/cache-policy.ts`
2. Add a `CACHE_KEYS` entry in `packages/cache/src/cache-keys.ts` if needed
3. Add invalidation handling in `packages/github/src/webhooks/resource-invalidation.ts`
4. Use `cachedRead` in the service function

## Do not

- Inline `getCached`/`setCache` calls — use `cachedRead` instead
- Cache write operations (POST/PUT/PATCH/DELETE)
- Use different TTLs for the same endpoint in different callsites
