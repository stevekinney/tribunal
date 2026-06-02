<script lang="ts" module>
  import type { HTMLInputAttributes } from 'svelte/elements';

  export type InputProps = Omit<HTMLInputAttributes, 'size' | 'value' | 'placeholder' | 'id'> & {
    /** Unique identifier for the input (required for SSR/CSR hydration and accessibility) */
    id: string;
    error?: string;
    /** Label text for the input (required for accessibility) */
    label: string;
    /** Visually hide the label while keeping it accessible to screen readers */
    hideLabel?: boolean;
    /** Placeholder text - defaults to label if hideLabel is true */
    placeholder?: string;
    /** Helper text displayed below the input */
    description?: string;
    value?: string;
  };
</script>

<script lang="ts">
  import { cn } from '../utilities/cn.js';
  import Label from '../label/label.svelte';

  let {
    class: className,
    error,
    label,
    hideLabel = false,
    placeholder,
    description,
    id,
    required,
    disabled,
    value = $bindable(''),
    ...rest
  }: InputProps = $props();

  const descriptionId = $derived(description ? `${id}-description` : undefined);
  const errorId = $derived(error ? `${id}-error` : undefined);
  const describedBy = $derived([descriptionId, errorId].filter(Boolean).join(' ') || undefined);
  const effectivePlaceholder = $derived(hideLabel && !placeholder ? label : placeholder);
</script>

<div class="form-field">
  <Label
    for={id}
    required={!!required}
    disabled={!!disabled}
    class={hideLabel ? 'sr-only' : undefined}
  >
    {label}
  </Label>
  <input
    {id}
    class={cn('control', className)}
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={describedBy}
    placeholder={effectivePlaceholder}
    {required}
    {disabled}
    bind:value
    {...rest}
  />
  {#if description}
    <p id={descriptionId} class="field-description">{description}</p>
  {/if}
  {#if error}
    <p id={errorId} class="field-error">{error}</p>
  {/if}
</div>
