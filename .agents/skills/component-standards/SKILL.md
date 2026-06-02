---
name: component-standards
description: Apply frontend domain conventions for components, Svelte runes/attachments, route form UX, and testing patterns.
allowed-tools:
  - mcp__svelte__list-sections
  - mcp__svelte__get-documentation
  - mcp__svelte__svelte-autofixer
  - mcp__svelte__playground-link
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
---

# Component Standards

## When to use

- Creating or modifying components under `src/lib/components/**`
- Updating Svelte reactivity, attachments, or form UX behavior in frontend surfaces
- Implementing route-level UI behavior in `src/routes/**` that affects component interactions
- Writing or fixing frontend tests (`*.svelte.test.ts`, E2E UI flows)

## Do not use

- Pure server/database workflows
- GitHub integration backends with no frontend touch points

## Constraints

- Follow `{baseDir}/rules/component-library.md`
- Follow `{baseDir}/rules/svelte-patterns.md` and `{baseDir}/rules/svelte-routes.md` when route behavior is involved
- Follow `{baseDir}/rules/testing.md` for frontend test environment selection
- No Tailwind; use tokens from `tokens.css`
- Variants via `data-*` attributes, not conditional utility classes

## Operation modes

### 1) Component API and variants

- Define props/types in `<script lang="ts" module>`
- Merge external classes with `cn()` only
- Use snippets for projected content (`children`, `header`, `footer`)
- Shared components (cards, badges, headers, controls) must use the canonical implementation; do not fork per-page

### 2) Reactivity and attachments

- Prefer `$state`, `$derived`, `$bindable`, and minimal `$effect`
- Use `{@attach}` for DOM behavior and cleanup correctly
- Re-run `mcp__svelte__svelte-autofixer` until clean

### 3) Route and form UX

- Use SvelteKit form/action patterns with explicit success/error states
- Ensure cache invalidation and streamed UI behavior are aligned with route rules
- Avoid client-fetch mutations when form actions fit

### 4) Frontend testing and accessibility

- Use the right environment (`.svelte.test.ts` for browser)
- Cover keyboard interaction and ARIA expectations in tests
- Keep deterministic fixtures and avoid brittle timing patterns
- Critical surfaces must have tests covering light+dark themes, narrow+wide viewports, and empty/active/error states
- Use `documentation/testing/ui-regression-matrix.md` permutation template for acceptance criteria

## Workflow

1. Inspect similar components/routes/tests for the existing pattern.
2. Apply the smallest change that fits component + Svelte + testing rules.
3. Update tests for the new or changed behavior.
4. Run autofixer and targeted checks for touched frontend areas.

## Verification

- `mcp__svelte__svelte-autofixer` returns clean for changed `.svelte` files.
- Tests exist or are updated for new props/variants/states.
- Relevant frontend tests pass (for example `bun run --cwd applications/web test:unit:client`).
- For critical surfaces: permutation coverage (theme, viewport, state) is documented in the ticket or pull request.

## Additional references

- [Component Library Reference](references/component-library-reference.md)
- [Frontend Domain Reference](references/frontend-domain-reference.md)
- [UI Regression Matrix](../../../documentation/testing/ui-regression-matrix.md)
- [Route Behavior Checklist](../../../documentation/testing/route-behavior-checklist.md)
