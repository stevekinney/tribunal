<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { ActionResult } from '@sveltejs/kit';
  import type { HTMLFormAttributes } from 'svelte/elements';

  export type FormActionState = {
    isSubmitting: boolean;
  };

  export type FormProps = Omit<HTMLFormAttributes, 'method' | 'onsubmit'> & {
    /** HTTP method. Default: "POST" */
    method?: 'POST' | 'GET';
    /** ActionData - displays error if form.error exists */
    form?: { error?: string } | null;
    /** Hidden input values (Record<string, string | number | boolean>) */
    values?: Record<string, string | number | boolean>;
    /** Keep loading state on redirect. Default: true */
    persistOnRedirect?: boolean;
    /** Called with result before default behavior (SvelteKit mode only) */
    onresult?: (result: ActionResult) => void | Promise<void>;
    /** Submit handler for standalone mode (disables use:enhance). Return promise to track loading state. */
    onsubmit?: (event: SubmitEvent) => void | Promise<void>;
    /** Submit button area - REQUIRED for forms needing custom validation (canSubmit) */
    actions?: Snippet<[FormActionState]>;
    /** Default submit button label (only used when no actions snippet) */
    submitLabel?: string;
    /** Default submit button loading label (only used when no actions snippet) */
    submittingLabel?: string;
    /** Form content */
    children?: Snippet;
  };
</script>

<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import { enhance } from '$app/forms';
  import { cn } from '../utilities/cn.js';
  import Alert from '../alert/alert.svelte';
  import Button from '../button/button.svelte';

  let {
    class: className,
    method = 'POST',
    form,
    values,
    persistOnRedirect = true,
    onresult,
    onsubmit,
    actions,
    submitLabel = 'Submit',
    submittingLabel = 'Submitting…',
    children,
    ...rest
  }: FormProps = $props();

  let isSubmitting = $state(false);

  // Standalone mode submit handler
  async function handleSubmit(event: SubmitEvent) {
    if (!onsubmit) return;
    event.preventDefault();
    isSubmitting = true;
    try {
      await onsubmit(event);
    } finally {
      isSubmitting = false;
    }
  }

  // Attachment that conditionally applies enhance or submit handler
  const formAttachment: Attachment<HTMLFormElement> = (formElement) => {
    if (onsubmit) {
      // Standalone mode: use submit event listener
      formElement.addEventListener('submit', handleSubmit);
      return () => formElement.removeEventListener('submit', handleSubmit);
    } else {
      // SvelteKit mode: use enhance
      const { destroy } = enhance(formElement, () => {
        isSubmitting = true;
        return async ({ result, update }) => {
          await onresult?.(result);
          if (!persistOnRedirect || result.type !== 'redirect') {
            isSubmitting = false;
          }
          await update();
        };
      });
      return destroy;
    }
  };
</script>

<form
  {method}
  class={cn('form', className)}
  aria-busy={isSubmitting || undefined}
  {@attach formAttachment}
  {...rest}
>
  {#if form?.error}
    <Alert variant="danger" role="alert" description={form.error} />
  {/if}

  {#if children}{@render children()}{/if}

  {#if values}
    {#each Object.entries(values) as [name, value] (name)}
      <input type="hidden" {name} value={String(value)} />
    {/each}
  {/if}

  <div class="form-actions">
    {#if actions}
      {@render actions({ isSubmitting })}
    {:else}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? submittingLabel : submitLabel}
      </Button>
    {/if}
  </div>
</form>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }
</style>
