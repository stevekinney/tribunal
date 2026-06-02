<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type BaseCardProps = HTMLAttributes<HTMLDivElement> & {
    children?: Snippet;
    /** Footer content */
    footer?: Snippet;
    /** Right-side header actions */
    actions?: Snippet;
    /** Remove padding from card content (useful for lists) */
    flush?: boolean;
  };

  /** Card with custom header snippet - full control over header content */
  type CardWithHeader = BaseCardProps & {
    /** Custom header content (renders the entire header, use for complex layouts) */
    header: Snippet;
    title?: never;
    description?: never;
    icon?: never;
    count?: never;
    actions?: never;
  };

  /** Card with title/description props - simpler API for standard cards */
  type CardWithTitleDescription = BaseCardProps & {
    header?: never;
    /** Simple title string - rendered as h3 */
    title?: string;
    /** Simple description string - rendered below title */
    description?: string;
    /** Optional icon to display before the title */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon?: any;
    /** Count rendered as a Badge next to the title */
    count?: number;
  };

  export type CardProps = CardWithHeader | CardWithTitleDescription;
</script>

<script lang="ts">
  import { cn } from '../utilities/cn.js';
  import { Badge } from '../badge/index.js';

  let {
    class: className,
    children,
    title,
    description,
    icon: Icon,
    count,
    header,
    footer,
    actions,
    flush = false,
    ...rest
  }: CardProps = $props();

  const hasHeader = $derived(title || description || header || actions);
</script>

<div class={cn('card', className)} data-flush={flush} {...rest}>
  {#if hasHeader}
    <div class="card-header">
      {#if header}
        {@render header()}
      {:else}
        <div class="card-header-main">
          {#if Icon}
            <Icon class="icon-sm text-disabled" />
          {/if}
          <div class="card-title-group">
            <div class="card-title-row">
              {#if title}
                <h3 class="card-title">{title}</h3>
              {/if}
              {#if count != null}
                <Badge variant="default" label={String(count)} />
              {/if}
            </div>
            {#if description}
              <p class="card-description">{description}</p>
            {/if}
          </div>
        </div>
        {#if actions}
          <div class="card-header-actions">
            {@render actions()}
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  {#if children}
    <div class="card-content">
      {@render children()}
    </div>
  {/if}

  {#if footer}
    <div class="card-footer">
      {@render footer()}
    </div>
  {/if}
</div>

<style>
  .card {
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    border: 1px solid var(--border-muted);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-muted);
  }

  .card-header-main {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    flex: 1;
    min-width: 0;
  }

  .card-header-main :global(.icon-sm) {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .card-title-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    flex: 1;
    min-width: 0;
  }

  .card-title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .card-title {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .card-header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .card-description {
    font-size: var(--text-sm);
    color: var(--text-subtle);
  }

  .card-content {
    padding: var(--space-4);
  }

  .card[data-flush='true'] .card-content {
    padding: 0;
  }

  .card-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 var(--space-4) var(--space-3);
  }
</style>
