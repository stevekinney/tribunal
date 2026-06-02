<script lang="ts" module>
  import type { ComponentType, SvelteComponent } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type IconComponent = ComponentType<SvelteComponent<{ class?: string }>>;

  export type BreadcrumbItem = {
    /** Display label for this breadcrumb item */
    label: string;
    /** URL to navigate to - omit for current page (last item) */
    href?: string;
    /** Optional icon component to show before the label (Lucide icon or similar) */
    icon?: IconComponent;
  };

  export type BreadcrumbsProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
    /** Array of breadcrumb items to display */
    items: BreadcrumbItem[];
  };
</script>

<script lang="ts">
  import { ChevronRight } from 'lucide-svelte';
  import { cn } from '../utilities/cn.js';

  let { items, class: className, ...rest }: BreadcrumbsProps = $props();
</script>

<nav aria-label="Breadcrumb" class={cn('breadcrumbs', className)} {...rest}>
  <ol class="breadcrumb-list">
    {#each items as item, index (index)}
      <li class="breadcrumb-item">
        {#if index > 0}
          <ChevronRight class="icon-sm breadcrumb-separator" aria-hidden="true" />
        {/if}
        {#if item.href}
          <a href={item.href} class="breadcrumb-link">
            {#if item.icon}
              <item.icon class="icon-sm" />
            {/if}
            <span>{item.label}</span>
          </a>
        {:else}
          <span class="breadcrumb-current">
            {#if item.icon}
              <item.icon class="icon-sm" />
            {/if}
            <span aria-current="page">{item.label}</span>
          </span>
        {/if}
      </li>
    {/each}
  </ol>
</nav>

<style>
  .breadcrumbs {
    font-size: var(--text-sm);
  }

  .breadcrumb-list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .breadcrumb-item {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  :global(.breadcrumb-separator) {
    color: var(--text-disabled);
    flex-shrink: 0;
  }

  .breadcrumb-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-muted);
    text-decoration: none;
    border-radius: var(--radius-sm);
    padding: var(--space-0-5) var(--space-1);
    margin: calc(var(--space-0-5) * -1) calc(var(--space-1) * -1);
    transition:
      color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);
  }

  .breadcrumb-link:hover {
    color: var(--text);
    background-color: var(--surface-hover);
  }

  .breadcrumb-link:focus-visible {
    outline: 2px solid transparent;
    box-shadow:
      0 0 0 var(--ring-offset) var(--ring-offset-color),
      0 0 0 calc(var(--ring-offset) + var(--ring-width)) var(--control-ring-color);
  }

  .breadcrumb-current {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text);
    font-weight: var(--font-medium);
  }
</style>
