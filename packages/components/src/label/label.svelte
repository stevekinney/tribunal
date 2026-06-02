<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLLabelAttributes } from 'svelte/elements';

  export type LabelProps = HTMLLabelAttributes & {
    required?: boolean;
    optional?: boolean;
    disabled?: boolean;
    children?: Snippet;
    /** Text label - use instead of children for simple text content */
    text?: string;
  };
</script>

<script lang="ts">
  import { cn } from '../utilities/cn.js';

  let {
    class: className,
    required = false,
    optional = false,
    disabled = false,
    children,
    text,
    ...rest
  }: LabelProps = $props();
</script>

<label class={cn('label', className)} data-disabled={disabled} {...rest}>
  {#if children}{@render children()}{:else if text}{text}{/if}
  {#if required}
    <span class="label-required" aria-hidden="true"></span>
    <span class="sr-only">(required)</span>
  {/if}
  {#if optional}
    <span class="label-optional">(optional)</span>
  {/if}
</label>

<style>
  .label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    line-height: 1;
    color: var(--text);
  }

  .label[data-disabled='true'] {
    cursor: not-allowed;
  }

  /* Note: disabled styling handled by parent form field context */

  .label-required {
    flex-shrink: 0;
    width: 0.375rem;
    height: 0.375rem;
    background: var(--error);
    border-radius: 50%;
  }

  .label-optional {
    font-weight: var(--font-normal);
    color: var(--text-muted);
  }
</style>
