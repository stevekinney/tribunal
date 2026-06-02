<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';

  export type IconContainerVariant = 'default' | 'outlined';

  export type IconContainerProps = HTMLAttributes<HTMLDivElement> & {
    variant?: IconContainerVariant;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon: any;
  };
</script>

<script lang="ts">
  import { cn } from '../utilities/cn.js';

  let { variant = 'default', class: className, icon: Icon, ...rest }: IconContainerProps = $props();
</script>

<div class={cn('icon-container', className)} data-variant={variant} {...rest}>
  <Icon class="icon-container-icon" />
</div>

<style>
  .icon-container {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: var(--radius-lg);
    width: 2.5rem;
    height: 2.5rem;
  }

  :global(.icon-container-icon) {
    width: 1.25rem;
    height: 1.25rem;
  }

  .icon-container[data-variant='default'] {
    background: var(--surface-hover);
    color: var(--text-subtle);
  }

  .icon-container[data-variant='outlined'] {
    background: var(--surface-overlay);
    box-shadow: inset 0 0 0 1px var(--border);
    color: var(--text-muted);
  }
</style>
