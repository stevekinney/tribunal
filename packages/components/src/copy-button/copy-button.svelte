<script lang="ts" module>
  import type { ButtonVariant, ButtonSize } from '../button/button.svelte';

  export interface CopyButtonProps {
    /** The text to copy to clipboard */
    text: string;
    class?: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Copy, Check } from 'lucide-svelte';
  import Button from '../button/button.svelte';
  import { useClipboard } from '../utilities/use-clipboard.svelte.js';

  let {
    text,
    variant = 'secondary',
    size = 'sm',
    fullWidth = false,
    class: className,
  }: CopyButtonProps = $props();

  const clipboard = useClipboard();
  onDestroy(() => clipboard.destroy());

  const iconClass = $derived(size === 'xs' ? 'icon-xs' : 'icon-sm');
</script>

<Button
  {variant}
  {size}
  {fullWidth}
  class={className}
  onclick={() => clipboard.copy(text)}
  aria-label={clipboard.isCopied ? 'Copied!' : 'Copy to clipboard'}
  title={clipboard.isCopied ? 'Copied!' : 'Copy to clipboard'}
>
  {#if clipboard.isCopied}
    <Check class={`${iconClass} copy-icon-success`} />
  {:else}
    <Copy class={iconClass} />
  {/if}
</Button>

<style>
  :global(.copy-icon-success) {
    color: var(--success);
  }
</style>
