<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';

  export type DropdownSeparatorProps = HTMLAttributes<HTMLDivElement>;
</script>

<script lang="ts">
  import { cn } from '../utilities/cn.js';

  let { class: className, ...rest }: DropdownSeparatorProps = $props();
</script>

<div class={cn('dropdown-separator', className)} role="separator" {...rest}></div>

<style>
  .dropdown-separator {
    margin-block: var(--space-1);
    height: 1px;
    background: var(--border);
  }
</style>
