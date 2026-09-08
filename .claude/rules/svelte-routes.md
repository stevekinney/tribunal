---
paths:
  - applications/web/src/routes/**/*.svelte
  - applications/web/src/routes/**
  - applications/web/src/params/**
  - applications/web/src/lib/server/**
  - applications/web/src/hooks.server.*
---

# SvelteKit Routes and Server Patterns

Before editing paths in this rule, load `$component-standards` and apply its constraints.
For detailed patterns and code examples, see `component-standards` references.

## Page architecture

- Standalone pages use `<Page>` with title, description, icon, actions snippet.
- Tabbed layouts use `createTabs()` in the layout; child routes render content directly (no wrapper).
- Use `await parent()` in child load functions when parent data is needed; call it after independent fetches to avoid waterfalls.

## Forms

- A form posting to a named page action is a plain `<form method="POST" action="?/name" use:enhance>` with `<input type="hidden">` for values not bound to a visible control. `use:enhance` belongs only on that shape — it is for POSTs to SvelteKit page actions, so leave it off the GET filter forms and the forms that post to an API endpoint, both of which exist here and are correct as they are.
- There is no shared `Form` component. Earlier revisions of this rule mandated one from `$lib/components` that has never existed in this repository, along with the `isSubmitting`, `onresult`, `values` and `form={null}` props that came with it. If a shared form component is introduced later, restore that guidance then.
- Render `form?.error` yourself, once. Two alerts for one failure is the usual symptom of copying an error block into both a page and the component beneath it.
- Mirror server validation limits (e.g., `max(10)`) in the UI: gate the submit button and surface a clear message before submission.
- Keep that gate consistent with normalized input rules (for example, trimmed length vs raw `minlength`). Avoid states where HTML validation allows submission but the guard disables the button, or vice versa.
- Mutate `formData` inside `use:enhance`'s submit function when a value cannot be trusted to be current in the DOM — a debounced editor binding is the case this repository actually hit. That callback receives the same `FormData` instance used to build the request, so it is the last point that still affects what is posted; see the "Input handling" section of `svelte-patterns.md`.
- Always handle both success AND error states from form actions.
- In `use:enhance` callbacks, do not call `update()` when `result.type === 'error'`; return early to avoid navigating to `+error.svelte`.
- Each form action must re-validate permissions independently; auth is NOT inherited from layouts.
- Create and update actions for the same entity should validate fields identically.
- When moving named form actions between routes, keep legacy handlers temporarily **or** update every call site and test in the same change. Avoid breaking open tabs or in-repo tests that still post to the old action URL.

## Load functions

- Await critical data for initial render/SEO. Return promises for secondary data (streaming).
- Use `depends(...)` identifiers for anything you will invalidate after mutations.
- Parallelize independent fetches with `Promise.all`/`Promise.allSettled`; keep optional data in `allSettled`.
- Normalize and filter data in load functions, not components. Return both valid and stale IDs when selections reference external resources.
- Throw `error()`/`redirect()` early. Add friendly loading/error UI for streamed data.

## Cache invalidation

- When a page uses `depends(CACHE_KEY)`, invalidate the same key after successful form actions.
- When multiple form actions share a page, invalidate in each form's `use:enhance` result callback or return an explicit `actionType` so one handler can tell which action ran.

## Streamed data

- Use `<svelte:boundary>` with `pending`/`failed` snippets and `{@const items = await data.streamedItems}` (requires `experimental.async`).
- Wrap `{@const}` in `{#if true}` if it cannot be a direct child of `<svelte:boundary>`.
- Keep `.catch(() => {})` on streamed promises in server load functions to prevent Node unhandled rejection warnings.

## Hooks

- When returning a custom `Response` early (bypassing `resolve(event)`), manually add `Set-Cookie` headers; SvelteKit's cookie API only applies headers through `resolve()`.
- For custom endpoints in hooks, check pathname first, then return 405 for unsupported methods.

## Routing conventions

- Use param matchers: `[repositoryId=int]`, `[number=int]`, `[id=uuid]`; keep shared matchers in `applications/web/src/params`.
- Prefer shared param matchers defined in `applications/web/src/params` (for example `[id=uuid]`) instead of duplicating regex validation in handlers. If a 400 response for malformed IDs is required, reuse the matcher function from `applications/web/src/params/uuid.ts` to avoid regex drift.
- Authenticated routes in `(authenticated)`, public pages in `(public)`; add scoped `+error.svelte` per section.
- Redirect-only routes: implement in `+page.server` with `export const prerender = true` when static.

## URL and query params

- Validate URL params before use; check for `NaN` and invalid values.
- Validate query params against allowed values before passing to database filters.
- Preserve existing filter state when linking to detail views; clear detail selection when filters change.
- Use `goto` with `replaceState: true` (not `replaceState()` from `$app/navigation`) for URL-driven sheet/modal close.

## API and webhook patterns

- Use `Buffer.byteLength(payload, 'utf8')` for payload size validation, not `string.length`.
- Return `null` on failure for functions with `Promise<T | null>` contracts; do not throw.
- Use `Promise.allSettled` for non-critical secondary operations (cache invalidation).
- SSE/ReadableStream endpoints must add a `cancel()` handler or `request.signal` listener to clean up on disconnect.

## Database query patterns

- Avoid N+1 queries; use JOINs. Use `selectDistinct` for deduplication when JOINs produce duplicates.
- Isolate cascading data fetch errors with separate try-catch blocks so secondary failures do not hide primary data.

## UI patterns

- Distinguish "no data" from "no capability" with a capability flag from the server.
- Show pagination controls even when client-side filtering empties a page but more data exists.
- Use `limit + 1` pattern for server pagination instead of `hasMore = runs.length === limit`.
- Use block statements with explicit `preventDefault()` for keyboard handlers on interactive elements.
- Avoid non-null assertions in event handlers inside conditionals; guard inside the handler.
- Avoid double spaces in conditional text interpolation; use full ternary expressions.
- For countdown timers, always update `now` unconditionally and let `$derived` compute the clamped value.
- Clear stale feedback messages when parent selections change in cascading forms.
- Prefer API-provided URLs over constructed URLs for external resource links.

## Shared server utilities

- Extract identical form action logic (validation, processing) to shared utilities in `src/lib/server/`.
- Create data attachment utilities for loading entities with related data.
