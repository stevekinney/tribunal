---
applyTo: '**/*.svelte,**/*.svelte.ts,**/components/**'
---

# Svelte Component Review Heuristics

These apply to the Svelte 5 components in `packages/components/src/**` (the
`@tribunal/components` library) and any `.svelte` files in `applications/web`.

## Component structure

- Use `cn()` from `packages/components/src/utilities/cn.ts` for merging external `class` props. Inside the package, import it relatively (`../utilities/cn.js`). Forward unknown attributes via `{...rest}`.
- Variants via `data-*` attributes, not conditional classes. Boolean `data-*` must resolve to `true`/`false` or be omitted via `value || undefined` — never a ternary that yields `undefined` as a string.
- Use Snippets for content slots (`children`, `header`, `footer`, `actions`) — not Svelte 4 slots.
- Export types in module context (`<script lang="ts" module>`), not in the default script block.
- Icons: type as `ComponentType<SvelteComponent<{ class?: string }>>` (commonly aliased `IconComponent`). Size with the `.icon-xs`, `.icon-sm`, `.icon-md`, `.icon-lg` utility classes.

## Styling

- No Tailwind. Use CSS custom properties from `packages/components/src/styles/tokens.css` and scoped `<style>`.
- Tokens: spacing (`--space-0` to `--space-32`), typography (`--text-xs`, `--text-sm`, `--text-base`, `--text-lg`, `--text-xl`), colors (`--text`, `--text-muted`, `--text-subtle`), surfaces (`--surface`, `--surface-raised`, `--surface-overlay`, plus state variants like `--surface-hover`), semantic (`--accent`, `--success`, `--warning`, `--danger`), radii (`--radius-sm` to `--radius-full`).
- Layer order (declared in `styles/index.css`): `@layer tokens, foundation, components, utilities;`. The `foundation` layer combines reset and base styles.
- Never use the `hidden` attribute with CSS grid transitions — `[hidden] { display: none !important; }` overrides `display: grid`.

## Reactivity (Svelte 5 runes)

- `$derived` is read-only. No mutations inside `$derived` or `$derived.by()`.
- `$derived(expression)` for simple expressions. `$derived.by(() => { ... })` for multi-statement logic.
- **Never** `$derived(() => ...)` — this creates a derived that holds a function, not the computed result.
- `$effect` must clean up timers, observers, and event sources in its return function.
- After `await` in effects, check `element.isConnected` before touching DOM references.
- Use `$bindable()` instead of bridging internal state with effects for two-way binding.
- Reset state at the start of `$effect` blocks that handle streamed data (SvelteKit reuses components on navigation).

## Forms

- Always use the `Form` component (`packages/components/src/form/form.svelte`) — never raw `<form>`.
- `Form` wraps `use:enhance`, tracks `isSubmitting`, displays `form.error` automatically, and exposes an `onresult` callback. It also supports a standalone mode via `onsubmit` (which disables `use:enhance`).
- Handle both success and error states from form actions.
- Each form action must re-validate permissions independently.

## Accessibility

- Form controls require `id` and `label` (use `hideLabel` to visually hide).
- Overlays: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`/`aria-describedby`.
- Touch targets: `min-height: var(--touch-target-min)` (44px).
- Use `aria-pressed` (not `aria-selected`) for `role="button"` elements.
- Use the `.sr-only` pattern for screen-reader-only content.
- Destructive actions: typed confirmation, case-insensitive comparison, disabled until confirmed.
- Only one `<main>` element per document.

## Keyboard navigation

- Skip container shortcuts inside text inputs (`<input>`, `<textarea>`, `contenteditable`).
- Check `defaultPrevented` for Escape key before handling at the container level.
- Roving tabindex must `preventDefault()` on all handled keys.
- Scope navigation to the container element via Svelte context — never query `document`.

## SSR safety

- No `document`/`window`/`navigator` in module scope.
- Access browser APIs in event handlers or `$effect()` blocks with cleanup; guard with a `typeof window !== 'undefined'` check (or `browser` from `$app/environment` in route/app code) when needed.
- Use `Symbol()` context keys and guard with `hasContext()`.

## Streamed data

- Use `<svelte:boundary>` with `pending`/`failed` snippets for async data.
- Keep `.catch(() => {})` on streamed promises in server load functions to prevent Node unhandled rejection warnings.
