<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  export type OverlayVariant = 'modal' | 'sheet';

  export type OverlayBaseProps = Omit<HTMLAttributes<HTMLDivElement>, 'id'> & {
    /** Required unique ID for accessibility */
    id: string;
    /** Whether the overlay is open */
    open?: boolean;
    /** Overlay title - required for accessibility */
    title: string;
    /** Optional description text below the title */
    description?: string;
    /** Show the close button (default: true) */
    showClose?: boolean;
    /** Called when the overlay is closed */
    onClose?: () => void;
    /** Close when clicking the overlay backdrop (default: true) */
    closeOnOverlayClick?: boolean;
    /** Close when pressing Escape (default: true) */
    closeOnEscape?: boolean;
    /** Visual variant: 'modal' (centered) or 'sheet' (side panel) */
    variant?: OverlayVariant;
    /** Body content snippet */
    body?: Snippet;
    /** Footer content snippet */
    footer?: Snippet;
    /** Main content - use body/footer snippets for standard layout */
    children?: Snippet;
  };
</script>

<script lang="ts">
  import { cn } from '../utilities/cn.js';
  import { bodyScrollLock, createFocusTrap, createFocusOnMount } from '../utilities/attachments.js';

  let {
    id,
    class: className,
    open = $bindable(false),
    title,
    description,
    showClose = true,
    onClose,
    closeOnOverlayClick = true,
    closeOnEscape = true,
    variant = 'modal',
    body,
    footer,
    children,
    ...rest
  }: OverlayBaseProps = $props();

  const titleId = $derived(`${id}-title`);
  const descriptionId = $derived(`${id}-desc`);

  function close() {
    open = false;
    onClose?.();
  }

  function handleOverlayClick(event: MouseEvent) {
    if (closeOnOverlayClick && event.target === event.currentTarget) {
      close();
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (closeOnEscape && event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }
</script>

{#if open}
  <div
    {id}
    class={cn('overlay-backdrop', className)}
    data-variant={variant}
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    aria-describedby={description ? descriptionId : undefined}
    onclick={handleOverlayClick}
    onkeydown={handleKeyDown}
    tabindex="-1"
    {@attach bodyScrollLock}
    {...rest}
  >
    <div
      class="overlay-content"
      tabindex="-1"
      {@attach createFocusTrap()}
      {@attach createFocusOnMount()}
    >
      {#if showClose}
        <button type="button" class="overlay-close" onclick={close} aria-label="Close">
          <svg
            class="overlay-close-icon"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      {/if}

      <div class="overlay-header">
        <h2 id={titleId} class="overlay-title">{title}</h2>
        {#if description}
          <p id={descriptionId} class="overlay-description">{description}</p>
        {/if}
      </div>

      {#if body}
        <div class="overlay-body">
          {@render body()}
        </div>
      {/if}

      {@render children?.()}

      {#if footer}
        <div class="overlay-footer">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay, 50);
    background: var(--overlay-backdrop);
  }

  .overlay-content {
    position: fixed;
    z-index: var(--z-overlay-content, 51);
    background: var(--surface-overlay);
    overflow: visible;
  }

  .overlay-header {
    display: flex;
    flex-direction: column;
    text-align: left;
  }

  .overlay-title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--text);
  }

  .overlay-description {
    font-size: var(--text-sm);
    color: var(--text-subtle);
  }

  .overlay-body {
    color: var(--text-muted);
  }

  .overlay-footer {
    display: flex;
    flex-direction: column-reverse;
    gap: var(--space-2);
  }

  @media (min-width: 640px) {
    .overlay-footer {
      flex-direction: row;
      justify-content: flex-end;
    }
  }

  /* Modal variant */
  .overlay-backdrop[data-variant='modal'] .overlay-content {
    left: 50%;
    top: 50%;
    display: grid;
    width: calc(100% - 2rem);
    max-width: 32rem;
    max-height: calc(100vh - 2rem);
    transform: translate(-50%, -50%);
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }

  @media (min-width: 640px) {
    .overlay-backdrop[data-variant='modal'] .overlay-content {
      padding: var(--space-6);
    }

    .overlay-backdrop[data-variant='modal'] .overlay-close {
      right: var(--space-4);
      top: var(--space-4);
    }
  }

  .overlay-backdrop[data-variant='modal'] .overlay-header {
    gap: var(--space-1-5);
    padding-right: var(--space-8);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border-muted);
  }

  .overlay-backdrop[data-variant='modal'] .overlay-title {
    line-height: 1;
    letter-spacing: -0.01em;
  }

  .overlay-backdrop[data-variant='modal'] .overlay-body {
    flex: 1;
    font-size: var(--text-sm);
  }

  /* Sheet variant */
  .overlay-backdrop[data-variant='sheet'] .overlay-content {
    right: 0;
    top: 0;
    height: 100%;
    width: 100%;
    max-width: 100%;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border);
    box-shadow: var(--shadow-xl);
    transform: translateX(0);
    transition: transform var(--duration-normal) var(--ease-standard);
  }

  @media (min-width: 640px) {
    .overlay-backdrop[data-variant='sheet'] .overlay-content {
      width: min(24rem, 80vw);
    }
  }

  @media (min-width: 1024px) {
    .overlay-backdrop[data-variant='sheet'] .overlay-content {
      width: min(32rem, 50vw);
    }
  }

  .overlay-backdrop[data-variant='sheet'] .overlay-header {
    gap: var(--space-2);
    padding: var(--space-4);
    border-bottom: 1px solid var(--border);
  }

  @media (min-width: 640px) {
    .overlay-backdrop[data-variant='sheet'] .overlay-header {
      padding: var(--space-6);
    }
  }

  .overlay-backdrop[data-variant='sheet'] .overlay-title {
    padding-right: var(--space-8);
  }

  .overlay-backdrop[data-variant='sheet'] .overlay-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4);
  }

  @media (min-width: 640px) {
    .overlay-backdrop[data-variant='sheet'] .overlay-body {
      padding: var(--space-6);
    }
  }

  .overlay-backdrop[data-variant='sheet'] .overlay-footer {
    padding: var(--space-4);
    border-top: 1px solid var(--border);
  }

  @media (min-width: 640px) {
    .overlay-backdrop[data-variant='sheet'] .overlay-footer {
      padding: var(--space-6);
    }

    .overlay-backdrop[data-variant='sheet'] .overlay-close {
      right: var(--space-4);
      top: var(--space-4);
    }
  }

  .overlay-backdrop[data-variant='sheet'] .overlay-close {
    min-width: 2.75rem;
    min-height: 2.75rem;
    padding: var(--space-2);
  }
</style>
