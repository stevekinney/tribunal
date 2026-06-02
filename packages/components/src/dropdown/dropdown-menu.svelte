<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  export type DropdownMenuProps = HTMLAttributes<HTMLDivElement> & {
    children?: Snippet;
  };
</script>

<script lang="ts">
  import { hasContext, getContext, tick } from 'svelte';
  import { cn } from '../utilities/cn.js';
  import {
    DROPDOWN_CONTEXT,
    DROPDOWN_REGISTER,
    DROPDOWN_SET_OPEN,
    type DropdownContext,
  } from './dropdown.svelte';

  if (!hasContext(DROPDOWN_CONTEXT)) {
    throw new Error('DropdownMenu must be used within a Dropdown');
  }

  let { class: className, children, ...rest }: DropdownMenuProps = $props();

  const context = getContext<DropdownContext>(DROPDOWN_CONTEXT);
  const registerMenu = getContext<(el: HTMLElement | null) => void>(DROPDOWN_REGISTER);
  const setOpen = getContext<(open: boolean) => void>(DROPDOWN_SET_OPEN);

  let menuRef = $state<HTMLDivElement | null>(null);

  // Register with parent for close functionality
  $effect(() => {
    registerMenu(menuRef);
    return () => registerMenu(null);
  });

  function handleKeyDown(event: KeyboardEvent) {
    const items = menuRef?.querySelectorAll('[role="menuitem"]:not([data-disabled])');
    if (!items?.length) return;

    const itemsArray = Array.from(items) as HTMLElement[];
    const currentIndex = itemsArray.findIndex((item) => item === document.activeElement);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = currentIndex < itemsArray.length - 1 ? currentIndex + 1 : 0;
      itemsArray[nextIndex].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : itemsArray.length - 1;
      itemsArray[prevIndex].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      itemsArray[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      itemsArray[itemsArray.length - 1].focus();
    }
  }

  // Update open state and focus first item when popover opens
  function handleToggle(event: ToggleEvent) {
    const isOpenNow = event.newState === 'open';
    setOpen(isOpenNow);

    if (isOpenNow && menuRef) {
      tick().then(() => {
        const firstItem = menuRef?.querySelector('[role="menuitem"]:not([data-disabled])');
        (firstItem as HTMLElement)?.focus();
      });
    }
  }
</script>

<div
  bind:this={menuRef}
  id={context.menuId}
  popover="auto"
  class={cn('dropdown-menu', className)}
  style:position-anchor={`--${context.menuId}`}
  role="menu"
  aria-orientation="vertical"
  tabindex={-1}
  onkeydown={handleKeyDown}
  ontoggle={handleToggle}
  {...rest}
>
  {@render children?.()}
</div>

<style>
  .dropdown-menu {
    position: fixed;
    inset: auto;
    margin: 0;
    min-width: 12rem;
    max-width: calc(100vw - 1rem);
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--surface-overlay);
    box-shadow: var(--shadow-lg);
    outline: none;
    padding: var(--space-1);
    top: calc(anchor(bottom) + 4px);
    right: anchor(right);
    position-try-fallbacks: flip-block, flip-inline;
  }
</style>
