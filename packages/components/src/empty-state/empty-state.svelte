<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet, ComponentType, SvelteComponent } from 'svelte';

  // Icon component type compatible with Lucide icons (Svelte 4 style class components)
  type IconComponent = ComponentType<SvelteComponent<{ class?: string }>>;

  export type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
    icon?: IconComponent;
    title: string;
    description?: string;
    action?: Snippet;
  };
</script>

<script lang="ts">
  import { cn } from '../utilities/cn.js';

  let {
    icon: Icon,
    title,
    description,
    action,
    class: className,
    ...rest
  }: EmptyStateProps = $props();
</script>

<div class="empty-state-container">
  <div class={cn('empty-state', className)} {...rest}>
    {#if Icon}
      <div class="empty-state-icon">
        <Icon class="icon-lg" />
      </div>
    {/if}
    <h3 class="empty-state-title">{title}</h3>
    {#if description}
      <p class="empty-state-description">{description}</p>
    {/if}
    {#if action}
      <div class="empty-state-action">
        {@render action()}
      </div>
    {/if}
  </div>
</div>

<style>
  .empty-state-container {
    container-type: inline-size;
  }

  .empty-state {
    text-align: center;
    padding-block: var(--space-8);
  }

  .empty-state-icon {
    display: flex;
    justify-content: center;
    color: var(--text-disabled);
    margin-bottom: var(--space-2);
  }

  .empty-state-title {
    font-weight: var(--font-medium);
    color: var(--text-muted);
    font-size: var(--text-sm);
    margin-bottom: var(--space-1);
  }

  .empty-state-description {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .empty-state-action {
    margin-top: var(--space-4);
  }

  /* Compact variant for narrow containers (e.g., inside cards) */
  @container (max-width: 400px) {
    .empty-state {
      padding-block: var(--space-6);
    }

    .empty-state-description {
      display: none;
    }

    .empty-state-action {
      margin-top: var(--space-3);
    }
  }
</style>
