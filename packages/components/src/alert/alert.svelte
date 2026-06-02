<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

  export type AlertProps = HTMLAttributes<HTMLDivElement> & {
    variant?: AlertVariant;
    /** Optional title displayed above the description */
    title?: string;
    /** Description text for the alert (use instead of children for simple text) */
    description?: string;
    /** Complex content (use when you need more than plain text) */
    children?: Snippet;
    dismissible?: boolean;
    onDismiss?: () => void;
  };
</script>

<script lang="ts">
  import { cn } from '../utilities/cn.js';

  let {
    variant = 'info',
    class: className,
    title,
    description,
    children,
    dismissible = false,
    onDismiss,
    ...rest
  }: AlertProps = $props();

  let visible = $state(true);

  function handleDismiss() {
    visible = false;
    onDismiss?.();
  }
</script>

{#if visible}
  <div
    class={cn('alert', className)}
    data-variant={variant}
    role="alert"
    aria-live="polite"
    {...rest}
  >
    <div class="alert-content">
      {#if title}
        <h5 class="alert-title">{title}</h5>
      {/if}
      {#if description}
        <p class="alert-description">{description}</p>
      {:else if children}
        <div class="alert-description">
          {@render children()}
        </div>
      {/if}
    </div>
    {#if dismissible}
      <button type="button" class="alert-close" onclick={handleDismiss} aria-label="Dismiss alert">
        <svg
          class="alert-close-icon"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
          />
        </svg>
      </button>
    {/if}
  </div>
{/if}

<style>
  .alert {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    border-width: 1px;
    border-style: solid;
    transition: background-color var(--duration-fast) var(--ease-standard);
  }

  .alert-content {
    flex: 1;
    min-width: 0;
  }

  .alert-title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    margin-bottom: var(--space-1);
  }

  .alert-description {
    font-size: var(--text-sm);
    margin-bottom: var(--space-3);
    word-break: break-word;
  }

  .alert-description:last-child {
    margin-bottom: 0;
  }

  .alert-close {
    position: absolute;
    right: var(--space-3);
    top: var(--space-3);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    padding: var(--space-0-5);
    border-radius: var(--radius-md);
    border: none;
    background: transparent;
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-standard),
      box-shadow var(--duration-fast) var(--ease-standard);
  }

  /* WCAG 2.5.8: Invisible 44x44px touch target via pseudo-element */
  .alert-close::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    transform: translate(-50%, -50%);
  }

  .alert-close:focus-visible {
    outline: 2px solid transparent;
    box-shadow:
      0 0 0 var(--ring-offset) var(--ring-offset-color),
      0 0 0 calc(var(--ring-offset) + var(--ring-width)) var(--alert-ring);
  }

  .alert-close-icon {
    width: 1rem;
    height: 1rem;
  }

  /* Variant: info */
  .alert[data-variant='info'] {
    --alert-ring: var(--info);
    background-color: light-dark(
      oklch(from var(--info) 96.5% 0.015 h),
      oklch(from var(--info) 20% 0.03 h)
    );
    border-color: light-dark(
      oklch(from var(--info) 85% 0.05 h),
      oklch(from var(--info) 35% 0.08 h)
    );
    color: var(--info);
  }

  .alert[data-variant='info'] .alert-close:hover {
    background-color: light-dark(
      oklch(from var(--info) 92% 0.03 h),
      oklch(from var(--info) 25% 0.05 h)
    );
  }

  /* Variant: success */
  .alert[data-variant='success'] {
    --alert-ring: var(--success);
    background-color: light-dark(
      oklch(from var(--success) 96.5% 0.015 h),
      oklch(from var(--success) 20% 0.03 h)
    );
    border-color: light-dark(
      oklch(from var(--success) 85% 0.05 h),
      oklch(from var(--success) 35% 0.08 h)
    );
    color: var(--success);
  }

  .alert[data-variant='success'] .alert-close:hover {
    background-color: light-dark(
      oklch(from var(--success) 92% 0.03 h),
      oklch(from var(--success) 25% 0.05 h)
    );
  }

  /* Variant: warning */
  .alert[data-variant='warning'] {
    --alert-ring: var(--warning);
    background-color: light-dark(
      oklch(from var(--warning) 96.5% 0.015 h),
      oklch(from var(--warning) 20% 0.03 h)
    );
    border-color: light-dark(
      oklch(from var(--warning) 85% 0.05 h),
      oklch(from var(--warning) 35% 0.08 h)
    );
    color: var(--warning);
  }

  .alert[data-variant='warning'] .alert-close:hover {
    background-color: light-dark(
      oklch(from var(--warning) 92% 0.03 h),
      oklch(from var(--warning) 25% 0.05 h)
    );
  }

  /* Variant: danger */
  .alert[data-variant='danger'] {
    --alert-ring: var(--danger);
    background-color: light-dark(
      oklch(from var(--danger) 96.5% 0.015 h),
      oklch(from var(--danger) 20% 0.03 h)
    );
    border-color: light-dark(
      oklch(from var(--danger) 85% 0.05 h),
      oklch(from var(--danger) 35% 0.08 h)
    );
    color: var(--danger);
  }

  .alert[data-variant='danger'] .alert-close:hover {
    background-color: light-dark(
      oklch(from var(--danger) 92% 0.03 h),
      oklch(from var(--danger) 25% 0.05 h)
    );
  }
</style>
