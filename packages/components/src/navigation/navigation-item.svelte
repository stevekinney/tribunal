<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';

  export type NavigationItemLayout = 'horizontal' | 'vertical';

  export type NavigationItemProps = HTMLAnchorAttributes & {
    href: string;
    children?: Snippet;
    layout?: NavigationItemLayout;
  };
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { cn } from '../utilities/cn.js';
  import { NAVIGATION_CONTEXT, type NavigationContext } from './navigation.svelte';

  let {
    href,
    class: className,
    children,
    layout = 'horizontal',
    ...rest
  }: NavigationItemProps = $props();

  const context = getContext<NavigationContext | undefined>(NAVIGATION_CONTEXT);

  const isActive = $derived(page.url.pathname === href || page.url.pathname.startsWith(`${href}/`));

  function handleClick() {
    // Close mobile drawer when navigating (if open)
    context?.closeMobile();
  }
</script>

<a
  {href}
  class={cn('navigation-item', className)}
  data-layout={layout}
  data-active={isActive}
  aria-current={isActive ? 'page' : undefined}
  onclick={handleClick}
  {...rest}
>
  {@render children?.()}
</a>

<style>
  .navigation-item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    font-weight: var(--font-medium);
    text-decoration: none;
    transition: color var(--duration-fast) var(--ease-standard);
  }

  .navigation-item:focus-visible {
    outline: 2px solid transparent;
    box-shadow:
      0 0 0 var(--ring-offset) var(--ring-offset-color),
      0 0 0 calc(var(--ring-offset) + var(--ring-width)) var(--control-ring-color);
  }

  /* Horizontal layout (desktop nav bar) */
  .navigation-item[data-layout='horizontal'] {
    min-height: 2rem;
    padding-inline: var(--space-3);
    padding-block: var(--space-1-5);
    font-size: var(--text-sm);
    border-bottom: 2px solid transparent;
  }

  .navigation-item[data-layout='horizontal'][data-active='true'] {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .navigation-item[data-layout='horizontal'][data-active='false'] {
    color: var(--text-muted);
  }

  .navigation-item[data-layout='horizontal'][data-active='false']:hover {
    color: var(--text);
  }

  /* Vertical layout (mobile drawer) */
  .navigation-item[data-layout='vertical'] {
    width: 100%;
    min-height: 3rem;
    padding-inline: var(--space-4);
    padding-block: var(--space-3);
    font-size: var(--text-base);
    border-radius: var(--radius-lg);
  }

  .navigation-item[data-layout='vertical'][data-active='true'] {
    background: color-mix(in oklch, var(--accent), transparent 85%);
    color: var(--accent);
  }

  .navigation-item[data-layout='vertical'][data-active='false'] {
    color: var(--text-subtle);
  }

  .navigation-item[data-layout='vertical'][data-active='false']:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
</style>
