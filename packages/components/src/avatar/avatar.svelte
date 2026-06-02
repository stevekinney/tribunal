<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';

  export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

  export type AvatarProps = HTMLAttributes<HTMLSpanElement> & {
    src?: string | null;
    /** Alt text for the image, also used to derive initials if name/initials not provided */
    alt?: string;
    /** The name of the person/entity - used to derive initials */
    name?: string;
    /** Explicit initials to display (overrides name/alt derivation) */
    initials?: string;
  };
</script>

<script lang="ts">
  import { cn } from '../utilities/cn.js';

  let { class: className, src, alt = '', name, initials, ...rest }: AvatarProps = $props();

  let imageError = $state(false);

  function handleError() {
    imageError = true;
  }

  const effectiveName = $derived(name || alt || '');
  const showImage = $derived(src && !imageError);
  const displayInitials = $derived.by(() => {
    if (initials) return initials;
    if (!effectiveName) return '';

    return effectiveName
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  });
</script>

<span class={cn('avatar', className)} {...rest}>
  {#if showImage}
    <img {src} alt={effectiveName} class="avatar-image" onerror={handleError} />
  {:else}
    <span class="avatar-initials" aria-hidden="true">
      {displayInitials}
    </span>
    <span class="sr-only">{effectiveName}</span>
  {/if}
</span>

<style>
  .avatar {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 9999px;
    background: var(--surface-inset);
    color: var(--text-muted);
    font-weight: var(--font-semibold);
    border: 1px solid var(--border-muted);
    height: 2rem;
    width: 2rem;
    font-size: var(--text-sm);
  }

  .avatar-initials {
    line-height: 1;
    text-transform: uppercase;
  }

  .avatar-image {
    height: 100%;
    width: 100%;
    object-fit: cover;
  }
</style>
