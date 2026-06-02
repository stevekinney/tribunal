---
paths:
  - src/lib/**/*.ts
---

# Caching patterns

## Cache mutation safety

When caching function results that contain mutable data (arrays, objects), **both cache hit AND cache miss paths must return clones** to prevent caller mutations from corrupting cached entries.

```typescript
// WRONG: Cache miss returns direct reference - caller can corrupt cache
function computeWithCache(key: string): Result {
  const cached = cache.get(key);
  if (cached) return cloneResult(cached); // ✓ Cache hit protected

  const result = expensiveComputation();
  cache.set(key, result);
  return result; // ✗ Cache miss returns same reference stored in cache
}

// CORRECT: Both paths return clones
function computeWithCache(key: string): Result {
  const cached = cache.get(key);
  if (cached) return cloneResult(cached); // ✓ Cache hit protected

  const result = expensiveComputation();
  cache.set(key, result);
  return cloneResult(result); // ✓ Cache miss also protected
}
```

The bug is subtle: when `cache.set(key, result)` and `return result` use the same object reference, a caller mutating the returned result directly corrupts the cached entry.

## Deterministic cache keys

When cache keys include serialized options objects, use stable stringification with sorted keys:

```typescript
function stableStringifyOptions(options: Record<string, unknown>): string {
  const entries = Object.entries(options).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([key, value]) => `${key}:${JSON.stringify(value)}`).join('|');
}
```

This ensures `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce the same cache key, since object property order can vary.

- Keep key derivation in a single shared helper used by both readers and writers; avoid copy-pasted key assembly that can drift.
- Use deterministic key sorting that is runtime-stable across environments; avoid locale-aware ordering in cache key builders.

## Cache payload validity

- When cached payloads are expected to be non-empty content, treat empty-string values as cache misses and recompute.
- On cache-backed refresh paths, clear stale counters or dependent snapshots before loading replacement values to prevent stale UI totals.

## Clone depth

For results containing arrays of value objects (like `CodeBlockInfo[]`), shallow array cloning (`[...array]`) is typically sufficient since the inner objects are treated as immutable. Only deep clone when inner objects are genuinely mutated by callers.

## LRU cache eviction

When implementing LRU caches with size limits, only evict entries when adding a **new** key. Check if the key already exists before evicting:

```typescript
// WRONG: Evicts even when updating existing key
function setCached(key: string, value: string): void {
  if (cache.size >= MAX_SIZE) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey); // ✗ May evict unnecessarily
  }
  cache.set(key, value);
}

// CORRECT: Only evict when adding new key
function setCached(key: string, value: string): void {
  if (cache.size >= MAX_SIZE && !cache.has(key)) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey); // ✓ Only evicts when truly needed
  }
  cache.set(key, value);
}
```

Without the `!cache.has(key)` check, concurrent renders of identical content can cause unnecessary evictions: both miss the cache, both render, both call `setCached` with the same key. The second call would evict an entry before updating an existing key, reducing effective cache capacity.

## Async race conditions with shared state

When caching results from async operations that depend on shared module-level state, validate that the state hasn't changed before caching. Otherwise, a state change during the async operation can cause results computed with the NEW state to be cached under keys for the OLD state.

```typescript
// Module-level shared state
let globalConfig: Config | null = null;

// WRONG: Caches result computed with new config under old config's key
async function computeWithConfig(input: string, config: Config): Promise<Result> {
  await updateGlobalConfig(config); // Updates globalConfig
  const cacheKey = getCacheKey(input, config);

  const result = await expensiveAsyncComputation(input); // Uses globalConfig

  // Race: if another call updated globalConfig during computation,
  // this result was computed with the wrong config
  cache.set(cacheKey, result); // ✗ May cache wrong-config result
  return result;
}

// CORRECT: Verify state matches before caching
async function computeWithConfig(input: string, config: Config): Promise<Result> {
  await updateGlobalConfig(config); // Updates globalConfig
  const cacheKey = getCacheKey(input, config);

  const result = await expensiveAsyncComputation(input); // Uses globalConfig

  // Only cache if globalConfig still matches the intended config
  if (globalConfig === config) {
    cache.set(cacheKey, result); // ✓ Only caches if state unchanged
  }
  return result;
}
```

**Real-world example:** Mermaid diagram rendering with theme switching. The `mermaid.initialize(theme)` call updates a shared mermaid instance. If theme changes from 'default' to 'dark' while a 'default' render is in progress, the render completes with the dark-themed instance, but would be cached under the 'default' key without a post-render validation check.

## Invalidate list caches on entity updates

When an entity mutation changes fields displayed in list views, invalidate both the entity cache AND the list cache. Otherwise, lists show stale data until full page reload.

```typescript
// After updating a goal (which changes title/status shown in list)
$effect(() => {
  if (form?.success && form?.updated) {
    invalidate(CACHE_KEYS.GOAL(data.goal.id));           // Entity detail
    invalidate(CACHE_KEYS.GOALS_FOR_PROJECT(projectId)); // List that shows title/status
  }
});
```

Common cases requiring list invalidation:
- **Restore/revert operations** - May change title, status, or other list-visible fields
- **Status changes** - Often displayed with badges in list views
- **Title/name updates** - Primary display text in lists
- **Archive/delete** - Entity should disappear from active lists

## Invalidation key matching

- Prefix matching for invalidation keys must respect segment boundaries. Avoid raw `startsWith` that can match sibling IDs (`repo:4` must not match `repo:42`); use exact matches or `prefix + ':'` guards.
- When invalidation entries include TTL timestamps, drop expired entries before returning matches so stale invalidations do not accumulate or execute.

## Cache policy alignment (reader + writer)

- **Share TTL constants between readers and writers.** If a reader expects 7-day cache entries but the writer uses a 1-hour TTL, cache-read-only pages will appear to “forget” data and force repeated regeneration. Export a single TTL constant and import it in both cache write and read paths.
- **Preserve `stale_fallback` payloads.** If the cache layer stores a prior summary as `stale_fallback` after a failed regenerate, readers must return that payload (with its warning state) instead of treating it as a miss. Do not downgrade to “unavailable” when `stale_fallback` is present.
