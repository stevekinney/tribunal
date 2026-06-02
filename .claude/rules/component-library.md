---
paths:
  - src/lib/components/**
  - lib/components/**
---

# Component Library

Before editing paths in this rule, load `$component-standards` and apply its constraints.
For code examples, see `component-standards` references.

## Non-negotiables

- Use `cn()` from `$lib/utilities/cn.ts` for merging external `class` props only.
- Forward unknown attributes via `{...rest}`.
- No Tailwind. Use CSS custom properties from `tokens.css` and scoped `<style>`.
- Variants via `data-*` attributes, not conditional classes.
- Boolean `data-*` attributes: always evaluate to `true`/`false`, never use ternaries or logical OR with `undefined`.
- Union types with literal `false` for data attributes: explicitly convert `false` to the string `"false"` for CSS attribute selectors.
- Use Snippets for content slots (`children`, `header`, `footer`, `actions`).
- Export types in module context (`<script lang="ts" module>`).
- Icons: use `Component<{ class?: string }>` type.
- Client-only rendering: use `browser` from `$app/environment`, not `typeof window !== 'undefined'`.
- Position-based animations: ensure center positions do not reuse left/right animations unintentionally.
- Keyed lists: ensure keys in `{#each ... (key)}` are unique; guard against duplicate user-supplied IDs.
- Options merging: filter out `undefined` values before spreading defaults.
- Timer pause/resume: dismiss immediately if remaining time reaches zero while paused.
- For explicit-refresh preview components, route initial snapshot and refresh-time composition through the same helper to avoid drift between first render and manual refresh.
- When using `resolveTemplatePlaceholders` in preview refresh paths, always inspect `issues`. Unknown placeholders must surface clear user feedback and block snapshot replacement.
- Example components go in `test/examples/*-example.svelte`.
- Icon sizing: derive icon class from component size prop (`icon-xs` for `xs`, otherwise `icon-sm`).
- Clamp props used in loops to valid ranges before iterating.
- Avoid duplicate type exports in `index.ts`; export only the canonical type, not internal aliases.

## Shared component contracts

- Shared components (cards, badges, headers, controls, spacing utilities) must have a single canonical implementation. Do not create per-page variants that diverge from the canonical API.
- When a page needs behavior not covered by the shared component, extend the component API (add a prop or snippet) rather than forking the component or overriding styles inline.
- Card headers, badge layouts, and control groups must use consistent spacing tokens. Do not use ad-hoc pixel values that deviate from `tokens.css` spacing scale.
- When modifying a shared component, verify all existing usages still render correctly.
- If a component's API allows per-page divergence without guardrails (such as accepting arbitrary `class` overrides for structural layout), document the intended usage and constrain the API where feasible.
- See `documentation/testing/ui-regression-matrix.md` for permutation coverage requirements on shared components.

## Styling

- Tokens: spacing (`--space-1` to `--space-16`), typography (`--text-xs` to `--text-lg`), colors (`--text`, `--text-muted`, `--text-subtle`, `--text-disabled`), surfaces (`--surface`, `--surface-raised`, `--surface-overlay`), semantic (`--accent`, `--success`, `--warning`, `--danger`).
- Layer order: `@layer tokens, reset, base, components, utilities;`.
- When consolidating variants into a shared base, keep typography differences in variant selectors.
- CSS Grid animations: never use the `hidden` attribute with grid-template-rows transitions; the global `[hidden] { display: none !important; }` overrides `display: grid`.
- Use `data-*` attributes and `overflow: hidden` on content to control expanded/collapsed state.
- CSS selector cleanup: do not duplicate base class in attribute selectors (`.link[data-variant='default'][data-active='true']`, not `.link[data-variant='default'].link[data-active='true']`).
- When migrating custom icon classes to utility classes, check for non-sizing styles (color, alignment) and add a scoped `:global()` rule if needed.

## Accessibility

- Form controls require `id` and `label` (use `hideLabel` to visually hide).
- Overlays: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`/`aria-describedby`.
- Touch targets: prefer `min-height: var(--touch-target-min)` (44px); avoid clipping by parent `overflow: hidden`.
- Never use `--text-disabled` for informational text (fails contrast).
- Use `aria-pressed` (not `aria-selected`) for `role="button"` elements.
- Use `aria-live="polite"` for progress/status, `aria-live="assertive"` for errors/alerts. Pair with `aria-atomic="true"` when the entire region should be re-read.
- When using `aria-live`, include the matching role (`status` for polite updates, `alert` for assertive) so assistive tech announces changes reliably.
- Use `.sr-only` pattern for screen-reader-only content (icon-only buttons, status context, invisible live regions).
- Destructive actions: require explicit typed confirmation, case-insensitive comparison, disabled button until confirmed, `autocomplete="off"`.
- Skip link focus management: preserve existing `tabindex` and restore on blur.
- Respect `prefers-reduced-motion` in JavaScript: use `'auto'` (not `'instant'`) as the reduced-motion fallback for `scrollIntoView`.
- Only one `<main>` element per document; child routes and error pages must not create their own `<main>`.

## Forms

- Avoid nested `<form>` elements when composing form components; use a single form root.
- Forward form attributes and regular handler props through `{...rest}` so consumers can set `action`, `method`, `onsubmit`, and `novalidate` without wrapping.

## Keyboard navigation

- Capture state before modifying when restoring focus (save ID before setting to `null`).
- Skip container shortcuts inside text inputs (`<input>`, `<textarea>`, `contenteditable`).
- Check `defaultPrevented` for Escape key before handling at the container level.
- Use `classList.contains` (not `closest`) for exact element matching in keyboard handlers.
- Roving tabindex utilities must `preventDefault()` on all handled keys, even when index does not change.
- Navigation utilities with disabled items must stay at current index when all items are disabled.
- Handle unfocused state (`findIndex` returning `-1`) by defaulting to first or last item based on direction.
- Scope keyboard navigation to the container element via Svelte context, never query `document` for triggers.

## SSR and context

- Avoid `document`/`window`/`navigator` in module scope.
- Access browser APIs in event handlers or `$effect()` blocks with cleanup.
- Use `Symbol()` context keys and guard with `hasContext()`.

## :global() usage

- Use for: `@html` content styling, third-party component children, component class props.
- Avoid for icons; use `.icon-xs`, `.icon-sm`, `.icon-md`, `.icon-lg` utility classes instead.

## Avoiding dead code

- Remove unused CSS transitions targeting properties that never change.
- Remove unused `$state` variables and handlers that do not affect rendering.
- Prefer CSS pseudo-classes (`:focus`, `:hover`, `:active`) over equivalent JavaScript state.

## Long lists

- Use `content-visibility: auto` with `contain-intrinsic-size: auto <fallback>` for long scroll lists.
