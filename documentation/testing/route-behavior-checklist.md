# Route Behavior Checklist

This checklist defines the required behavioral verifications for SvelteKit route
changes. Route-level bugs (URL changes without page transitions,
action-200-with-failure-semantics) escaped because route-level smoke tests did
not exist.

## Background

Regressions in navigation transitions, form action error handling, and
back/forward behavior revealed that component-level
tests alone do not catch route-level behavioral issues. This checklist ensures
every route change includes behavioral verification.

## Navigation Transitions

### Link navigation

- [ ] Clicking a link updates the URL in the address bar.
- [ ] The target page content renders after navigation.
- [ ] The previous page content is no longer visible.
- [ ] Loading indicators appear during data fetching (if applicable).
- [ ] Navigation completes without a full page reload (SPA behavior preserved).

### Programmatic navigation (`goto`)

- [ ] `goto('/path')` updates the URL.
- [ ] `goto('/path')` renders the target page content.
- [ ] `goto('/path', { replaceState: true })` does not add a history entry.
- [ ] `goto('/path', { invalidateAll: true })` re-runs load functions.

### Back/forward

- [ ] Browser back button returns to the previous page with correct content.
- [ ] Browser forward button returns to the next page with correct content.
- [ ] Page state (scroll position, form values) is restored where expected.
- [ ] `popstate` does not cause duplicate data fetching.

### Edge cases

- [ ] Navigating to the current page does not cause a blank flash.
- [ ] Deep links (direct URL entry) render the correct page and load data.
- [ ] Links with hash fragments scroll to the target element.
- [ ] Guard redirects (authentication, authorization) fire before rendering.

## Form Action Behavior

### Standard form actions

- [ ] `POST` form submission triggers the action and returns a result.
- [ ] Successful actions show the success state (toast, redirect, or updated UI).
- [ ] Failed actions show the error state with a user-readable message.
- [ ] The form is re-enabled after the action completes (success or failure).
- [ ] `use:enhance` preserves SPA behavior (no full page reload).

### Failure-in-200 envelope

SvelteKit form actions return HTTP 200 even on failure, using the `ActionResult`
envelope. This is a common source of missed regressions.

- [ ] `{ type: 'success' }` results render success UI.
- [ ] `{ type: 'failure' }` results render error UI (not success UI).
- [ ] `{ type: 'failure', data: { errors } }` displays validation errors at the correct form fields.
- [ ] `{ type: 'redirect' }` navigates to the target URL.
- [ ] `{ type: 'error' }` shows the error page or fallback error UI.

### Progressive enhancement

- [ ] Forms work without JavaScript (graceful degradation).
- [ ] `use:enhance` callback handles both success and failure cases.
- [ ] Optimistic UI updates are rolled back on failure.

## Streaming and Deferred Data

### Streamed load functions

- [ ] Initial page renders with available data; deferred data shows loading state.
- [ ] Streamed promises resolve and update the UI without a full re-render.
- [ ] Streamed promise rejection shows error UI in the deferred section.
- [ ] Multiple streamed values resolve independently.

### Cache invalidation

- [ ] `invalidate('app:resource')` re-fetches only the affected load functions.
- [ ] `invalidateAll()` re-fetches all load functions for the current page.
- [ ] Cache invalidation after a mutation reflects the updated data.

## Full-Height Layout Contracts

Surfaces that use full-height layouts (for example a page that fills the viewport
with a pinned toolbar) require additional verification.

- [ ] The flex container fills the viewport height.
- [ ] The pinned element (composer, toolbar) stays at the bottom.
- [ ] Content scrolls independently of the pinned element.
- [ ] The layout adapts correctly at narrow and wide viewports.
- [ ] Container query breakpoints fire at expected thresholds.

## Testing Patterns

### E2E route tests

Place route-level Playwright tests in `applications/web/test/end-to-end/sveltekit/`.

```typescript
import { test, expect } from '@playwright/test';

test('navigating from list to detail updates URL and content', async ({ page }) => {
  await page.goto('/resources');
  await page.getByRole('link', { name: 'Resource Name' }).click();
  await expect(page).toHaveURL(/\/resources\/[\w-]+$/);
  await expect(page.getByRole('heading', { name: 'Resource Name' })).toBeVisible();
});

test('back button returns to list with preserved state', async ({ page }) => {
  await page.goto('/resources');
  await page.getByRole('link', { name: 'Resource Name' }).click();
  await page.goBack();
  await expect(page).toHaveURL('/resources');
  await expect(page.getByRole('link', { name: 'Resource Name' })).toBeVisible();
});
```

### Form action tests

```typescript
test('form action failure shows error message', async ({ page }) => {
  await page.goto('/settings');
  // Submit with invalid data
  await page.getByRole('textbox', { name: 'Name' }).fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  // Verify failure-in-200 renders error UI
  await expect(page.getByText('Name is required')).toBeVisible();
  // Verify form is re-enabled
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
});
```

## Applying This Checklist

### For ticket authors

1. Identify which route behaviors are affected by the change.
2. Include the relevant checklist sections in the ticket description.
3. Note any items that are not applicable with a reason.

### For implementers

1. Verify each applicable checklist item manually or via test.
2. Add E2E tests for navigation and form action changes.
3. Document any deferred verifications in the pull request description.

### For reviewers

1. Confirm the checklist is present in the ticket or pull request.
2. Verify that navigation and form action edge cases are covered.
3. Flag missing back/forward and failure-in-200 test coverage.

## Related Documents

- `.claude/rules/testing.md` -- testing environment and pattern rules
- `.claude/rules/svelte-routes.md` -- SvelteKit route conventions
- `documentation/testing/ui-regression-matrix.md` -- UI permutation matrix
