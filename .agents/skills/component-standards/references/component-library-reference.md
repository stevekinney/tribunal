# Component Library Reference

All code examples and detailed patterns extracted from `component-library.md`.

## Component anatomy

```svelte
<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
  export type ButtonProps = Omit<HTMLAttributes<HTMLButtonElement>, 'class'> & {
    class?: string;
    variant?: ButtonVariant;
    children?: Snippet;
  };
</script>

<script lang="ts">
  import { cn } from '$lib/utilities/cn';
  let { variant = 'secondary', class: className, children, ...rest }: ButtonProps = $props();
</script>

<button class={cn('button', className)} data-variant={variant} {...rest}>
  {@render children?.()}
</button>
```

## Union types with literal `false` for data attributes

When a prop type includes `false` as a literal (e.g., `'shimmer' | 'pulse' | false`) and is used in a CSS attribute selector like `[data-animation='false']`, explicitly convert the value to a string:

```typescript
type Animation = 'shimmer' | 'pulse' | false;
let { animation = 'shimmer' }: { animation?: Animation } = $props();
const animationAttr = $derived(animation === false ? 'false' : animation);
// Use in template: data-animation={animationAttr}
```

## Icon sizing from component size prop

```typescript
const iconClass = $derived(size === 'xs' ? 'icon-xs' : 'icon-sm');
```

## Clamping props used in loops

```typescript
// WRONG: Directly uses boundaries in loop, crashes when boundaries > totalPages
for (let i = 1; i <= boundaries; i++) pages.push(i);
for (let i = totalPages - boundaries + 1; i <= totalPages; i++) pages.push(i);

// CORRECT: Clamp to valid range before loops
const effectiveBoundaries = Math.min(boundaries, Math.floor(totalPages / 2));
const firstEnd = Math.min(effectiveBoundaries, totalPages);
const lastStart = Math.max(1, totalPages - effectiveBoundaries + 1);
```

## Styling tokens

| Category   | Tokens                                                       |
| ---------- | ------------------------------------------------------------ |
| Spacing    | `--space-1` to `--space-16`                                  |
| Typography | `--text-xs`, `--text-sm`, `--text-base`, `--text-lg`         |
| Colors     | `--text`, `--text-muted`, `--text-subtle`, `--text-disabled` |
| Surfaces   | `--surface`, `--surface-raised`, `--surface-overlay`         |
| Semantic   | `--accent`, `--success`, `--warning`, `--danger`             |

Layer order: `@layer tokens, reset, base, components, utilities;`.

## CSS Grid animations

When using CSS Grid transitions for height animations (`grid-template-rows: 0fr` to `1fr`), never use the `hidden` attribute. The global `[hidden] { display: none !important; }` rule overrides `display: grid`:

```css
/* WRONG: hidden attribute prevents grid animation */
<div class="panel" hidden={!isOpen}>
  <div class="content">...</div>
</div>

/* CORRECT: Use grid animation without hidden attribute */
<div class="panel">
  <div class="content">...</div>
</div>

.panel {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--duration) var(--ease-decelerate);
}

.item[data-expanded='true'] .panel {
  grid-template-rows: 1fr;
}

.content {
  overflow: hidden;
}
```

## Accessibility

### ARIA live regions

| Attribute               | When to use                                       | Behavior                               |
| ----------------------- | ------------------------------------------------- | -------------------------------------- |
| `aria-live="polite"`    | Progress updates, status changes, non-urgent info | Waits for user pause before announcing |
| `aria-live="assertive"` | Errors, alerts, urgent notifications              | Interrupts current speech immediately  |

Always pair with `aria-atomic="true"` when the entire region should be re-read on change:

```svelte
<!-- Progress updates (polite) -->
<div aria-live="polite" aria-atomic="true">
  {percentage}% complete
</div>

<!-- Error alerts (assertive) -->
<div role="alert" aria-live="assertive">
  {errorMessage}
</div>
```

### Screen-reader-only content

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

Common use cases:

- Announcing icon-only button purposes: `<button><Icon /><span class="sr-only">Close</span></button>`
- Providing context for status indicators: `<span class="sr-only">Status:</span> {statusLabel}`
- Live region announcements that shouldn't change visual layout

### Destructive action confirmation

```svelte
<script lang="ts">
  let confirmationInput = $state('');
  const expectedPhrase = $derived(`delete ${workspaceName}`);
  const isConfirmed = $derived(confirmationInput.toLowerCase() === expectedPhrase.toLowerCase());
</script>

<label for="confirm-delete">
  Type <code>{expectedPhrase}</code> to confirm
</label>
<input id="confirm-delete" type="text" bind:value={confirmationInput} autocomplete="off" />
<button disabled={!isConfirmed}>Permanently Delete</button>
```

Key requirements:

- Use case-insensitive comparison
- Disable the action button until confirmed
- Include `autocomplete="off"`
- Show the expected phrase in a `<code>` element

### Skip link focus management

```typescript
function handleSkipLink(targetId: string) {
  const element = document.getElementById(targetId);
  if (!element) return;

  const originalTabIndex = element.getAttribute('tabindex');
  element.setAttribute('tabindex', '-1');
  element.focus();
  element.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' });

  element.addEventListener(
    'blur',
    () => {
      if (originalTabIndex !== null) {
        element.setAttribute('tabindex', originalTabIndex);
      } else {
        element.removeAttribute('tabindex');
      }
    },
    { once: true },
  );
}
```

### Respecting prefers-reduced-motion in JavaScript

```typescript
function getScrollBehavior(): ScrollBehavior {
  if (typeof window !== 'undefined') {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return prefersReducedMotion ? 'auto' : 'smooth';
  }
  return 'auto';
}

element.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' });
```

Use `'auto'` (not `'instant'`) as the reduced-motion fallback since `'instant'` is non-standard.

### Landmark element nesting

```svelte
<!-- +layout.svelte -->
<main id="main-content">
  {@render children()}
</main>

<!-- +error.svelte - WRONG -->
<main class="error-page">...</main>

<!-- +error.svelte - CORRECT -->
<div class="error-page">...</div>
```

## Keyboard navigation

### Capture state before modifying

```typescript
const previousId = expandedId;
expandedId = null;
querySelector(`[data-id="${previousId}"]`)?.focus();
```

### Skip container shortcuts inside text inputs

```typescript
const isTextInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
if (event.altKey && event.key === 'ArrowDown' && !isTextInput) { ... }
```

### Check `defaultPrevented` for Escape key

```typescript
if (event.key === 'Escape' && !event.defaultPrevented) {
  event.preventDefault();
  event.stopPropagation();
  onCancel?.();
}
```

### Use `classList.contains` not `closest` for exact element matching

```typescript
// WRONG: Fires when any descendant of .item-toggle is focused
if (target.closest('.item-toggle')) {
  toggleExpand();
}

// CORRECT: Only fires when .item-toggle itself is focused
if (target.classList.contains('item-toggle')) {
  toggleExpand();
}
```

### Roving tabindex: always prevent default on handled keys

```typescript
// WRONG: Only prevents default when index changes, causing scroll at boundaries
const newIndex = handleRovingKeydown(event, currentIndex, items.length);
if (newIndex !== null && newIndex !== currentIndex) {
  event.preventDefault();
  selectItem(newIndex);
}

// CORRECT: Prevents default for all handled keys
const newIndex = handleRovingKeydown(event, currentIndex, items.length);
if (newIndex !== null) {
  event.preventDefault();
  if (newIndex !== currentIndex) {
    selectItem(newIndex);
  }
}
```

### Disabled items: return current index when all disabled

```typescript
// WRONG: Returns fallback index that might be disabled
function findFirstIndex(length, isDisabled) {
  if (!isDisabled) return 0;
  for (let i = 0; i < length; i++) {
    if (!isDisabled(i)) return i;
  }
  return 0; // Might be disabled
}

// CORRECT: Returns current index when all disabled
function findFirstIndex(length, isDisabled, currentIndex = 0) {
  if (!isDisabled) return 0;
  for (let i = 0; i < length; i++) {
    if (!isDisabled(i)) return i;
  }
  return currentIndex;
}
```

### Handle unfocused state in list navigation

```typescript
// WRONG: currentIndex of -1 leads to invalid targetIndex
const currentIndex = items.findIndex((el) => el === document.activeElement);
const targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

// CORRECT: Default to first/last based on direction
const currentIndex = items.findIndex((el) => el === document.activeElement);
let targetIndex: number;
if (currentIndex === -1) {
  targetIndex = direction === 'next' ? 0 : items.length - 1;
} else {
  targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
}
```

### Scope keyboard navigation to container element via context

```typescript
// In the container component (e.g., Accordion)
let containerElement = $state<HTMLDivElement | null>(null);

setContext<AccordionContext>(ACCORDION_CONTEXT, {
  get containerElement() { return containerElement; },
});

// In the template
<div bind:this={containerElement}>...</div>

// In the item component (e.g., AccordionItem)
function getEnabledTriggers(): HTMLButtonElement[] {
  const container = ctx.containerElement;
  if (!container) return [];

  return Array.from(container.querySelectorAll<HTMLButtonElement>(
    '[data-accordion-trigger]:not(:disabled)'
  ));
}
```

## :global() usage

Use `:global()` for:

1. `@html` content styling
2. Third-party component children where you control the parent
3. Component class props (style parent-scoped class passed to child root)

### Migrating from custom icon classes to utility classes

When replacing custom icon classes with utility classes (e.g., `.icon-md`), check if the original class had non-sizing styles:

```css
.card-header-main :global(.icon-md) {
  color: var(--accent);
  margin-top: 2px;
}
```

### CSS selector cleanup after data-attribute migration

```css
/* WRONG: Duplicated .link class */
.link[data-variant='default'].link[data-active='true'] {
}

/* CORRECT: Single .link class with chained attribute selectors */
.link[data-variant='default'][data-active='true'] {
}
```

## Attachments

Use `{@attach}` for DOM behavior (focus, scroll, resize, positioning). This replaces `use:` action directives.

### Type

```ts
import type { Attachment } from 'svelte/attachments';
```

### Typed attachment props

Accept attachments as component props for composition:

```ts
import type { Attachment } from 'svelte/attachments';

type Props = {
  containerAttachment?: Attachment<HTMLDivElement>;
  children: Snippet;
};

let { containerAttachment, children }: Props = $props();
```

```svelte
{#if containerAttachment}
  <div {@attach containerAttachment}>
    {@render children()}
  </div>
{:else}
  <div>
    {@render children()}
  </div>
{/if}
```

### Forwarding attachments

When a component wraps an element and needs to expose attachment capability:

```ts
type CardProps = {
  cardAttachment?: Attachment<HTMLDivElement>;
  // ... other props
};
```

### Multiple attachments

An element can have multiple `{@attach}` directives:

```svelte
<div {@attach positionAttachment} {@attach focusAttachment}>
```

### Migration from `use:` to `{@attach}`

| `use:` pattern        | `{@attach}` equivalent     |
| --------------------- | -------------------------- |
| `use:action`          | `{@attach action}`         |
| `use:action={params}` | `{@attach action(params)}` |

Key differences:

- Attachment functions receive the element directly (no `ActionReturn` protocol)
- Return a cleanup function directly (no `destroy` method on an object)
- TypeScript types use `Attachment<T>` instead of `Action<T>`

## See also

- `{baseDir}/rules/component-library.md`
- `/component` command (scaffolds new component)
