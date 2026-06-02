<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  export const NAVIGATION_CONTEXT = Symbol('navigation');

  export type NavigationContext = {
    closeMobile: () => void;
  };

  export type NavigationProps = HTMLAttributes<HTMLElement> & {
    /** Left side content (e.g., logo) - always visible */
    start?: Snippet;
    /** Navigation items - visible on desktop, in drawer on mobile */
    children?: Snippet;
    /** Right side content (e.g., user menu) - always visible on desktop, hidden on mobile */
    end?: Snippet;
    /** Content for mobile drawer (defaults to children if not provided) */
    drawer?: Snippet;
  };
</script>

<script lang="ts">
  import { setContext } from 'svelte';
  import { cn } from '../utilities/cn.js';
  import { X, Menu } from 'lucide-svelte';

  let { class: className, start, children, end, drawer, ...rest }: NavigationProps = $props();

  let drawerRef = $state<HTMLElement | null>(null);
  let isDrawerOpen = $state(false);

  function closeMobile() {
    drawerRef?.hidePopover();
  }

  function handleDrawerToggle(event: ToggleEvent) {
    isDrawerOpen = event.newState === 'open';
  }

  setContext<NavigationContext>(NAVIGATION_CONTEXT, {
    closeMobile,
  });
</script>

<nav class={cn('navigation', className)} aria-label="Main navigation" {...rest}>
  <!-- Left side (logo) -->
  {#if start}
    <div class="navigation-start">
      {@render start()}
    </div>
  {/if}

  <!-- Desktop navigation items -->
  <div class="navigation-desktop">
    {@render children?.()}
  </div>

  <!-- Right side: user menu (desktop) + mobile toggle -->
  <div class="navigation-end">
    <!-- User menu - hidden on mobile -->
    {#if end}
      <div class="navigation-end-desktop">
        {@render end()}
      </div>
    {/if}

    <!-- Mobile toggle -->
    <button
      type="button"
      class="navigation-toggle"
      popovertarget="navigation-drawer"
      aria-label="Open menu"
      aria-controls="navigation-drawer"
      aria-expanded={isDrawerOpen}
    >
      <Menu class="navigation-toggle-icon" />
    </button>
  </div>
</nav>

<!-- Mobile drawer - uses popover API with CSS animations -->
<aside
  bind:this={drawerRef}
  id="navigation-drawer"
  popover="auto"
  class="navigation-drawer"
  data-theme="dark"
  ontoggle={handleDrawerToggle}
>
  <button
    type="button"
    class="navigation-drawer-close"
    popovertarget="navigation-drawer"
    aria-label="Close menu"
  >
    <X class="navigation-drawer-close-icon" />
  </button>
  <div class="navigation-drawer-body">
    {#if drawer}
      {@render drawer()}
    {:else}
      {@render children?.()}
    {/if}
  </div>
</aside>

<style>
  .navigation {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 3.5rem;
  }

  .navigation-start {
    display: flex;
    align-items: center;
  }

  .navigation-desktop {
    display: none;
  }

  @media (min-width: 768px) {
    .navigation-desktop {
      display: flex;
      align-items: center;
      gap: var(--space-1);
    }
  }

  .navigation-end {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .navigation-end-desktop {
    display: none;
  }

  @media (min-width: 768px) {
    .navigation-end-desktop {
      display: flex;
      align-items: center;
    }
  }

  .navigation-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 2.5rem;
    width: 2.5rem;
    border-radius: var(--radius-md);
    border: none;
    background: transparent;
    color: var(--text-subtle);
    cursor: pointer;
    transition:
      color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);
  }

  .navigation-toggle:hover {
    color: var(--text);
    background: var(--surface-hover);
  }

  .navigation-toggle:active {
    background: var(--surface-active);
  }

  .navigation-toggle:focus-visible {
    outline: 2px solid transparent;
    box-shadow:
      0 0 0 var(--ring-offset) var(--ring-offset-color),
      0 0 0 calc(var(--ring-offset) + var(--ring-width)) var(--control-ring-color);
  }

  @media (min-width: 768px) {
    .navigation-toggle {
      display: none;
    }
  }

  :global(.navigation-toggle-icon) {
    width: 1.5rem;
    height: 1.5rem;
  }

  .navigation-drawer {
    position: fixed;
    inset: auto;
    top: 0;
    left: 0;
    margin: 0;
    height: 100%;
    width: 20rem;
    max-width: 85vw;
    background: var(--surface);
    box-shadow: var(--shadow-2xl);
    transition:
      transform var(--duration-normal) var(--ease-standard),
      opacity var(--duration-normal) var(--ease-standard);
    transition-behavior: allow-discrete;
    transform: translateX(0);
    opacity: 1;
  }

  .navigation-drawer:popover-open {
    display: flex;
    flex-direction: column;
  }

  @starting-style {
    .navigation-drawer:popover-open {
      transform: translateX(-100%);
      opacity: 0;
    }
  }

  .navigation-drawer::backdrop {
    background: oklch(0% 0 0 / 50%);
    transition: opacity var(--duration-normal) var(--ease-standard);
    transition-behavior: allow-discrete;
  }

  @starting-style {
    .navigation-drawer::backdrop {
      opacity: 0;
    }
  }

  @media (min-width: 768px) {
    .navigation-drawer {
      display: none;
    }
  }

  .navigation-drawer-close {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    padding: var(--space-2);
    border: none;
    background: transparent;
    color: var(--text-subtle);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-standard);
  }

  .navigation-drawer-close:hover {
    color: var(--text);
  }

  :global(.navigation-drawer-close-icon) {
    width: 1.25rem;
    height: 1.25rem;
  }

  .navigation-drawer-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding-inline: var(--space-3);
    padding-block: var(--space-4);
  }
</style>
