<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  export type DropdownLabelProps = HTMLAttributes<HTMLDivElement> & {
    children?: Snippet;
  };
</script>

<script lang="ts">
  import { cn } from '../utilities/cn.js';

  let { class: className, children, ...rest }: DropdownLabelProps = $props();
</script>

<div class={cn('dropdown-label', className)} {...rest}>
  {@render children?.()}
</div>

<style>
  .dropdown-label {
    padding-inline: var(--space-3);
    padding-block: var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
  }
</style>
