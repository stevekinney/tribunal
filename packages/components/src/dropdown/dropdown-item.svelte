<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  export type DropdownItemVariant = 'default' | 'danger';

  export type DropdownItemProps = HTMLButtonAttributes & {
    variant?: DropdownItemVariant;
    inset?: boolean;
    closeOnSelect?: boolean;
    children?: Snippet;
  };
</script>

<script lang="ts">
  import { hasContext, getContext } from 'svelte';
  import { cn } from '../utilities/cn.js';
  import { DROPDOWN_CONTEXT, type DropdownContext } from './dropdown.svelte';

  if (!hasContext(DROPDOWN_CONTEXT)) {
    throw new Error('DropdownItem must be used within a Dropdown');
  }

  let {
    variant = 'default',
    inset = false,
    disabled,
    closeOnSelect = true,
    class: className,
    onclick,
    children,
    ...rest
  }: DropdownItemProps = $props();

  const context = getContext<DropdownContext>(DROPDOWN_CONTEXT);

  function handleClick(event: MouseEvent) {
    if (disabled) return;
    if (onclick) {
      (onclick as (e: MouseEvent) => void)(event);
    }
    if (closeOnSelect) {
      context.close();
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (disabled) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick(event as unknown as MouseEvent);
    }
  }
</script>

<button
  type="button"
  role="menuitem"
  class={cn('dropdown-item', inset && 'dropdown-item-inset', className)}
  data-variant={variant}
  tabindex={disabled ? -1 : 0}
  data-disabled={disabled || undefined}
  aria-disabled={disabled}
  onclick={handleClick}
  onkeydown={handleKeyDown}
  {...rest}
>
  {@render children?.()}
</button>

<style>
  .dropdown-item {
    position: relative;
    display: flex;
    width: 100%;
    cursor: pointer;
    user-select: none;
    align-items: center;
    gap: var(--space-2);
    padding-inline: var(--space-3);
    padding-block: var(--space-2-5);
    min-height: 2.75rem;
    font-size: var(--text-sm);
    color: var(--text);
    outline: none;
    border: none;
    background: transparent;
    text-align: left;
    transition:
      background-color var(--duration-fast) var(--ease-standard),
      color var(--duration-fast) var(--ease-standard);
  }

  .dropdown-item[data-disabled] {
    pointer-events: none;
    opacity: 0.5;
  }

  .dropdown-item[data-variant='default']:hover,
  .dropdown-item[data-variant='default']:focus-visible {
    background: var(--surface-hover);
  }

  .dropdown-item[data-variant='default']:focus-visible {
    box-shadow: inset 0 0 0 2px var(--control-ring-color);
  }

  .dropdown-item[data-variant='default']:active {
    background: var(--surface-active);
  }

  .dropdown-item[data-variant='danger'] {
    color: var(--error);
  }

  .dropdown-item[data-variant='danger']:hover,
  .dropdown-item[data-variant='danger']:focus-visible {
    background: var(--surface-hover);
  }

  .dropdown-item[data-variant='danger']:focus-visible {
    box-shadow: inset 0 0 0 2px var(--control-ring-color);
  }

  .dropdown-item[data-variant='danger']:active {
    background: var(--surface-active);
  }

  .dropdown-item-inset {
    padding-left: var(--space-8);
  }
</style>
