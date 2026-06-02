<script lang="ts" module>
  import type { Snippet, ComponentType, SvelteComponent } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  /** Base visual variants for styling */
  type BaseVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger';

  /** All accepted badge variants, including domain-specific semantic statuses */
  export type BadgeVariant =
    | BaseVariant
    // Pipeline run statuses
    | 'started'
    | 'completed'
    | 'cancelled'
    // Phase execution statuses
    | 'not_started'
    | 'generating'
    | 'pending_review'
    | 'revising';

  /** Maps semantic status variants to their base CSS variant */
  const VARIANT_MAP: Record<string, BaseVariant> = {
    started: 'accent',
    completed: 'success',
    cancelled: 'warning',
    not_started: 'default',
    generating: 'accent',
    pending_review: 'warning',
    revising: 'accent',
  };

  export function resolveVariant(variant: BadgeVariant): BaseVariant {
    return VARIANT_MAP[variant] ?? (variant as BaseVariant);
  }
  export type BadgeSize = 'xs' | 'sm';

  type IconComponent = ComponentType<SvelteComponent<{ class?: string }>>;

  export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
    variant?: BadgeVariant;
    size?: BadgeSize;
    /** Snippet content for the badge */
    children?: Snippet;
    /** Text label for the badge - use instead of children for simple text */
    label?: string;
    /** Icon component to render before the label (Lucide icon or similar) */
    icon?: IconComponent;
    /** Display as monospace code style */
    code?: boolean;
    /** Allow clicking to copy the label value. Requires `label` prop to be set. */
    copyable?: boolean;
    /** Truncate to this many characters (displays full value in title) */
    truncate?: number;
  };
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Check, Copy } from 'lucide-svelte';
  import { cn } from '../utilities/cn.js';
  import { truncate as truncateText } from '../utilities/truncate.js';
  import { useClipboard } from '../utilities/use-clipboard.svelte.js';

  let {
    variant = 'default',
    size = 'sm',
    class: className,
    children,
    label,
    icon: Icon,
    code = false,
    copyable = false,
    truncate,
    ...rest
  }: BadgeProps = $props();

  const resolvedVariant = $derived(resolveVariant(variant));

  const clipboard = useClipboard();
  onDestroy(() => clipboard.destroy());

  const displayValue = $derived.by(() => {
    if (!label) return null;
    return truncate ? truncateText(label, truncate, '') : label;
  });

  const fullValue = $derived(label ?? '');

  // Only enable copyable behavior when label is provided
  const isCopyable = $derived(copyable && !!label);

  function handleCopy() {
    if (!isCopyable || !fullValue) return;
    clipboard.copy(fullValue);
  }
</script>

{#if isCopyable}
  <button
    type="button"
    onclick={handleCopy}
    class={cn('badge badge-copyable', className)}
    data-code={code}
    data-variant={resolvedVariant}
    data-size={size}
    title={clipboard.isCopied ? 'Copied!' : `Click to copy: ${fullValue}`}
    {...rest}
  >
    {#if Icon}<Icon class="icon-xs" />{/if}
    {#if children}{@render children()}{:else if displayValue}{displayValue}{/if}
    {#if clipboard.isCopied}
      <Check class="badge-icon badge-icon-success" />
    {:else}
      <Copy class="badge-icon badge-icon-muted" />
    {/if}
  </button>
{:else}
  <span
    class={cn('badge', className)}
    data-code={code}
    data-variant={resolvedVariant}
    data-size={size}
    title={truncate && label && label.length > truncate ? label : undefined}
    {...rest}
  >
    {#if Icon}<Icon class="icon-xs" />{/if}
    {#if children}{@render children()}{:else if displayValue}{displayValue}{/if}
  </span>
{/if}

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    line-height: 1.25;
    border-radius: var(--radius-sm);
    border-width: 1px;
    border-style: solid;
    white-space: nowrap;
    transition: background-color var(--duration-fast) var(--ease-standard);
  }

  .badge[data-size='xs'] {
    font-size: var(--text-3xs);
    padding: 0 var(--space-1);
    height: 1rem;
  }

  .badge[data-code='true'] {
    font-family: var(--font-mono);
    user-select: all;
  }

  .badge-copyable {
    cursor: pointer;
  }

  .badge-copyable:hover {
    background: var(--surface-hover);
  }

  .badge-icon {
    width: 0.75rem;
    height: 0.75rem;
  }

  .badge-icon-success {
    color: var(--success);
  }

  .badge-icon-muted {
    color: var(--text-subtle);
  }

  /* Variant: default */
  .badge[data-variant='default'] {
    background: var(--surface-inset);
    color: var(--text);
    border-color: var(--border-muted);
  }

  /* Variant: accent */
  .badge[data-variant='accent'] {
    background: color-mix(in oklch, var(--secondary), transparent 85%);
    color: var(--secondary);
    border-color: color-mix(in oklch, var(--secondary), transparent 60%);
  }

  /* Variant: success */
  .badge[data-variant='success'] {
    background: var(--success-bg);
    color: var(--success);
    border-color: var(--success-bg-strong);
  }

  /* Variant: warning */
  .badge[data-variant='warning'] {
    background: var(--warning-bg);
    color: var(--warning);
    border-color: var(--warning-bg-strong);
  }

  /* Variant: danger */
  .badge[data-variant='danger'] {
    background: var(--danger-bg);
    color: var(--danger);
    border-color: var(--danger-bg-strong);
  }
</style>
