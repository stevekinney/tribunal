<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes, HTMLAnchorAttributes } from 'svelte/elements';
  import type { Pathname } from '$app/types';

  export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'ghost-danger';
  export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

  type SharedProps = {
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
    loading?: boolean;
    /** Snippet content for the button */
    children?: Snippet;
    /** Text label for the button - use instead of children for simple text */
    label?: string;
    /** Icon component to render before the label (Lucide icon or similar) */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon?: any;
  };

  type BaseButtonProps = SharedProps & HTMLButtonAttributes & Omit<HTMLAnchorAttributes, 'type'>;

  type ButtonOnlyProps = BaseButtonProps & {
    href?: undefined;
    external?: undefined;
  };

  type InternalLinkButtonProps = BaseButtonProps & {
    /** Whether this is an external link */
    external?: false;
    /** Internal path (Pathname for autocomplete, or any string for dynamic routes) */
    href: Pathname | (string & {});
  };

  type ExternalLinkButtonProps = BaseButtonProps & {
    /** Whether this is an external link (adds target="_blank" and rel="noopener noreferrer") */
    external: true;
    /** External URL */
    href: string;
  };

  export type ButtonProps = ButtonOnlyProps | InternalLinkButtonProps | ExternalLinkButtonProps;
</script>

<script lang="ts">
  import { resolveHref } from '../utilities/resolve-href.js';
  import { cn } from '../utilities/cn.js';

  let {
    variant = 'secondary',
    size = 'sm',
    fullWidth = false,
    class: className,
    loading = false,
    disabled = false,
    href,
    external = false,
    target,
    rel,
    type = 'button' as const,
    onclick,
    children,
    label,
    icon: Icon,
    ...rest
  }: ButtonProps = $props();

  const isDisabled = $derived(disabled || loading);

  const resolvedHref = $derived(href ? (external ? href : resolveHref(href as string)) : undefined);

  // Icon size class based on button size
  const iconClass = $derived(size === 'xs' ? 'icon-xs' : 'icon-sm');
</script>

{#if href}
  <a
    href={resolvedHref}
    target={external ? '_blank' : target}
    rel={external ? 'noopener noreferrer' : rel}
    class={cn('button', className)}
    data-full-width={fullWidth}
    data-loading={loading}
    data-variant={variant}
    data-size={size}
    aria-disabled={isDisabled || undefined}
    {onclick}
    {...rest}
  >
    {#if loading && Icon}
      <svg
        class="button-spinner"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle class="spinner-track" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
        ></circle>
        <path
          class="spinner-head"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
    {:else if loading}
      <svg
        class="button-spinner"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle class="spinner-track" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
        ></circle>
        <path
          class="spinner-head"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
    {:else if Icon}
      <Icon class={iconClass} />
    {/if}
    {#if children}{@render children()}{:else if label}{label}{/if}
  </a>
{:else}
  <button
    {type}
    class={cn('button', className)}
    data-full-width={fullWidth}
    data-loading={loading}
    data-variant={variant}
    data-size={size}
    disabled={isDisabled}
    aria-disabled={isDisabled || undefined}
    aria-busy={loading || undefined}
    {onclick}
    {...rest}
  >
    {#if loading && Icon}
      <svg
        class="button-spinner"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle class="spinner-track" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
        ></circle>
        <path
          class="spinner-head"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
    {:else if loading}
      <svg
        class="button-spinner"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle class="spinner-track" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
        ></circle>
        <path
          class="spinner-head"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
    {:else if Icon}
      <Icon class={iconClass} />
    {/if}
    {#if children}{@render children()}{:else if label}{label}{/if}
  </button>
{/if}

<style>
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    font-weight: var(--font-medium);
    white-space: nowrap;
    cursor: pointer;
    text-decoration: none;
    transition:
      background-color var(--duration-fast) var(--ease-standard),
      border-color var(--duration-fast) var(--ease-standard),
      color var(--duration-fast) var(--ease-standard),
      box-shadow var(--duration-fast) var(--ease-standard);
  }

  .button:hover {
    text-decoration: none;
  }

  .button:focus-visible {
    outline: 2px solid transparent;
    box-shadow:
      0 0 0 var(--ring-offset) var(--ring-offset-color),
      0 0 0 calc(var(--ring-offset) + var(--ring-width))
        var(--button-ring, var(--control-ring-color));
  }

  .button:disabled,
  .button[aria-disabled='true'] {
    cursor: not-allowed;
    background: var(--surface-inset);
    color: var(--text-disabled);
    border-color: var(--border-muted);
    opacity: 0.5;
  }

  /* Loading buttons retain full opacity so the spinner remains visible.
     The spinner has internal opacity (track: 0.25, head: 0.75) that would
     compound with the disabled opacity, making the spinner nearly invisible. */
  .button[data-loading='true']:disabled,
  .button[data-loading='true'][aria-disabled='true'] {
    opacity: 1;
  }

  .button[data-full-width='true'] {
    width: 100%;
  }

  .button[data-loading='true'] {
    cursor: wait;
  }

  /* Size variants */
  .button[data-size='xs'] {
    font-size: var(--text-xs);
    padding: var(--space-0-5) var(--space-1-5);
    min-height: 1.5rem;
    border-radius: var(--radius-sm);
  }

  .button[data-size='sm'] {
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
    min-height: 2rem;
    border-radius: var(--radius-sm);
  }

  .button[data-size='md'] {
    font-size: var(--text-sm);
    padding: var(--space-1-5) var(--space-3);
    min-height: 2.25rem;
    border-radius: var(--radius-md);
  }

  .button[data-size='lg'] {
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-4);
    min-height: 2.5rem;
    border-radius: var(--radius-md);
  }

  /* Variant: primary */
  .button[data-variant='primary'] {
    --button-ring: var(--accent);
    background: var(--accent);
    color: var(--accent-contrast);
    border: none;
  }

  .button[data-variant='primary']:disabled,
  .button[data-variant='primary'][aria-disabled='true'] {
    background: var(--surface-inset);
    color: var(--text-disabled);
    border: 1px solid var(--border-muted);
  }

  .button[data-variant='primary']:hover:not(:disabled):not([aria-disabled='true']) {
    background: color-mix(in oklch, var(--accent), black 15%);
  }

  .button[data-variant='primary']:active:not(:disabled):not([aria-disabled='true']) {
    background: color-mix(in oklch, var(--accent), black 25%);
  }

  /* Variant: secondary */
  .button[data-variant='secondary'] {
    background: var(--surface-raised);
    color: var(--text);
    border: 1px solid var(--border);
  }

  .button[data-variant='secondary']:hover:not(:disabled):not([aria-disabled='true']) {
    background: var(--surface-hover);
  }

  .button[data-variant='secondary']:active:not(:disabled):not([aria-disabled='true']) {
    background: var(--surface-pressed);
  }

  /* Variant: danger */
  .button[data-variant='danger'] {
    --button-ring: var(--error);
    background: var(--error);
    color: var(--error-contrast);
    border: none;
  }

  .button[data-variant='danger']:hover:not(:disabled):not([aria-disabled='true']) {
    background: color-mix(in oklch, var(--error), black 15%);
  }

  .button[data-variant='danger']:active:not(:disabled):not([aria-disabled='true']) {
    background: color-mix(in oklch, var(--error), black 25%);
  }

  .button[data-variant='danger']:disabled,
  .button[data-variant='danger'][aria-disabled='true'] {
    background: var(--surface-inset);
    color: var(--text-disabled);
    border: 1px solid var(--border-muted);
  }

  /* Variant: ghost */
  .button[data-variant='ghost'] {
    background: transparent;
    color: var(--text-muted);
    border: none;
  }

  .button[data-variant='ghost']:hover:not(:disabled):not([aria-disabled='true']) {
    color: var(--text);
    background: var(--surface-hover);
  }

  .button[data-variant='ghost']:active:not(:disabled):not([aria-disabled='true']) {
    background: var(--surface-pressed);
  }

  .button[data-variant='ghost']:disabled,
  .button[data-variant='ghost'][aria-disabled='true'] {
    background: transparent;
  }

  /* Variant: ghost-danger */
  .button[data-variant='ghost-danger'] {
    --button-ring: var(--error);
    background: transparent;
    color: var(--danger);
    border: none;
  }

  .button[data-variant='ghost-danger']:hover:not(:disabled):not([aria-disabled='true']) {
    color: var(--danger-hover);
    background: var(--danger-bg);
  }

  .button[data-variant='ghost-danger']:active:not(:disabled):not([aria-disabled='true']) {
    background: var(--danger-bg-strong);
  }

  .button[data-variant='ghost-danger']:disabled,
  .button[data-variant='ghost-danger'][aria-disabled='true'] {
    background: transparent;
    color: var(--text-disabled);
  }

  /* Spinner - sizes match icon sizes */
  .button-spinner {
    flex-shrink: 0;
    animation: spin 1s linear infinite;
  }

  .button[data-size='xs'] .button-spinner {
    width: 0.75rem;
    height: 0.75rem;
  }

  .button[data-size='sm'] .button-spinner,
  .button[data-size='md'] .button-spinner,
  .button[data-size='lg'] .button-spinner {
    width: 1rem;
    height: 1rem;
  }

  .spinner-track {
    opacity: 0.25;
  }

  .spinner-head {
    opacity: 0.75;
  }

  /* Uses global @keyframes spin from utilities.css */
</style>
