<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';

  export type NavigationSeparatorProps = HTMLAttributes<HTMLDivElement>;
</script>

<script lang="ts">
  import { cn } from '../utilities/cn.js';

  let { class: className, ...rest }: NavigationSeparatorProps = $props();
</script>

<div
  class={cn('navigation-separator', className)}
  role="separator"
  aria-orientation="horizontal"
  {...rest}
></div>

<style>
  .navigation-separator {
    margin-block: var(--space-2);
    height: 1px;
    background: var(--border);
  }
</style>
