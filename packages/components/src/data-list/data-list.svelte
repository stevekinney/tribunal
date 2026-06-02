<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  export type DataListVariant = 'default' | 'compact';

  export type DataListProps<T = unknown> = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
    variant?: DataListVariant;
    /** Array of items to render */
    items: T[];
    /** Function to get unique key for each item */
    getKey: (item: T) => string | number;
    /** Snippet to render each item: (item, index, key, items) */
    item: Snippet<[item: T, index: number, key: string | number, items: T[]]>;
    /** Snippet to render when items is empty */
    empty?: Snippet;
  };

  export const DATA_LIST_CONTEXT = Symbol('data-list');
</script>

<script lang="ts" generics="T">
  import { setContext } from 'svelte';
  import { cn } from '../utilities/cn.js';

  let {
    class: className,
    items,
    getKey,
    item,
    empty,
    variant = 'default',
    ...rest
  }: DataListProps<T> = $props();

  setContext(DATA_LIST_CONTEXT, {
    get variant() {
      return variant;
    },
  });
</script>

<div class={cn('data-list', className)} data-variant={variant} {...rest}>
  {#if items.length > 0}
    {#each items as itemData, index (getKey(itemData))}
      {@render item(itemData, index, getKey(itemData), items)}
    {/each}
  {:else if empty}
    {@render empty()}
  {/if}
</div>

<style>
  .data-list[data-variant='compact'] {
    background: color-mix(in oklch, var(--surface-overlay), transparent 50%);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>
