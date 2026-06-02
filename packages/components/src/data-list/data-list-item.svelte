<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { DataListVariant } from './data-list.svelte';

  export type DataListItemProps = HTMLAttributes<HTMLElement> & {
    variant?: DataListVariant;
    children: Snippet;
    /** Optional right-aligned accessory content */
    accessory?: Snippet;
    /** If provided, renders as an anchor */
    href?: string;
    /** If true, opens link in new tab with noopener/noreferrer */
    external?: boolean;
  };
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import { ExternalLink } from 'lucide-svelte';
  import { resolveHref } from '../utilities/resolve-href.js';
  import { cn } from '../utilities/cn.js';
  import { DATA_LIST_CONTEXT } from './data-list.svelte';

  let {
    href,
    external = false,
    class: className,
    children,
    accessory,
    variant,
    ...rest
  }: DataListItemProps = $props();

  const context = getContext<{ variant: DataListVariant } | undefined>(DATA_LIST_CONTEXT);
  const resolvedVariant = $derived(variant ?? context?.variant ?? 'default');

  // Don't resolve external URLs - resolveHref is only for internal routes
  const isExternalUrl = (url: string) => /^(https?:)?\/\//.test(url);
  const resolvedHref = $derived(
    href && isExternalUrl(href) ? href : href ? resolveHref(href) : undefined,
  );

  // Treat as external if prop is set or URL pattern is external
  const isExternal = $derived(external || (href && isExternalUrl(href)));
</script>

{#if href}
  <a
    href={resolvedHref}
    class={cn('data-list-item', className)}
    data-variant={resolvedVariant}
    target={isExternal ? '_blank' : undefined}
    rel={isExternal ? 'noopener noreferrer' : undefined}
    {...rest}
  >
    <div class="data-list-item-content">
      {@render children()}
    </div>
    {#if accessory}
      {@render accessory()}
    {/if}
    {#if isExternal}
      <span class="external-indicator" aria-hidden="true">
        <ExternalLink class="icon-xs" />
      </span>
      <span class="sr-only">(opens in new tab)</span>
    {/if}
  </a>
{:else}
  <div class={cn('data-list-item', className)} data-variant={resolvedVariant} {...rest}>
    <div class="data-list-item-content">
      {@render children()}
    </div>
    {#if accessory}
      {@render accessory()}
    {/if}
  </div>
{/if}

<style>
  .data-list-item {
    display: flex;
    align-items: center;
    text-decoration: none;
    color: inherit;
  }

  .data-list-item[data-variant='default'] {
    gap: var(--space-4);
    padding-inline: var(--space-4);
    padding-block: var(--space-3);
    /* WCAG 2.5.8: Ensure minimum touch target height */
    min-height: var(--touch-target-min);
  }

  .data-list-item[data-variant='default']:not(:last-child) {
    border-bottom: 1px solid var(--border-muted);
  }

  a.data-list-item[data-variant='default'] {
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-standard);
  }

  a.data-list-item[data-variant='default']:hover {
    background: color-mix(in oklch, var(--surface-hover), transparent 70%);
  }

  a.data-list-item[data-variant='default']:focus {
    outline: none;
  }

  a.data-list-item[data-variant='default']:focus-visible {
    /* WCAG 2.2: Minimum 2px focus indicator */
    box-shadow: inset 0 0 0 2px var(--ring-color);
  }

  .data-list-item[data-variant='compact'] {
    justify-content: space-between;
  }

  .data-list-item-content {
    flex: 1;
    min-width: 0;
  }

  .external-indicator {
    flex-shrink: 0;
    color: var(--text-muted);
    margin-left: var(--space-2);
  }

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
</style>
