---
applyTo: '**/*.svelte,**/*.svelte.ts,**/components/**'
---

# Svelte Component Review Heuristics

These apply to the Svelte 5 components in `applications/web/src/lib/components`
and to any `.svelte` file in `applications/web`. The design system itself is
`@lostgradient/cinder`, consumed by subpath import; prefer a Cinder component,
or a composition of them, over a bespoke one.

## Component structure

- Use `cn()` from `$lib/utilities/cn` for merging external `class` props, and only for that. Forward unknown attributes via `{...rest}`.
- Variants via `data-*` attributes, not conditional classes. Boolean `data-*` must resolve to `true`/`false` or be omitted via `value || undefined` — never a ternary that yields `undefined` as a string.
- Use Snippets for content slots (`children`, `header`, `footer`, `actions`) — not Svelte 4 slots.
- Export types in module context (`<script lang="ts" module>`), not in the default script block.
- Icons: type as `ComponentType<SvelteComponent<{ class?: string }>>` (commonly aliased `IconComponent`). Size with the `.icon-xs`, `.icon-sm`, `.icon-md`, `.icon-lg` utility classes.

## Styling

- No Tailwind. Use CSS custom properties from `applications/web/src/lib/styles/tokens.css`, plus Cinder's own, and scoped `<style>`.
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

- There is no shared `Form` component. An earlier revision of this instruction required one from a component package, along with `isSubmitting`, `onresult` and a standalone `onsubmit` mode; neither that package nor that component has ever existed here.
- Write a plain `<form method="POST" action="?/name" use:enhance>` for a named page action on the current page, and render `form?.error` yourself. Leave `use:enhance` off GET filter forms, forms posting to an API endpoint, and deliberate plain cross-document submissions to another route's action.
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
