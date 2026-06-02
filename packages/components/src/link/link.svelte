<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import type { Pathname } from '$app/types';

  export type LinkVariant = 'default' | 'muted';

  type BaseLinkProps = Omit<HTMLAnchorAttributes, 'href'> & {
    variant?: LinkVariant;
    exact?: boolean;
    children?: Snippet;
    label?: string;
  };

  type InternalLinkProps = BaseLinkProps & {
    /** Whether this is an external link */
    external?: false;
    /** Internal path (Pathname for autocomplete, or any string for dynamic routes) */
    href: Pathname | (string & {});
  };

  type ExternalLinkProps = BaseLinkProps & {
    /** Whether this is an external link (adds target="_blank" and rel="noopener noreferrer") */
    external: true;
    /** External URL */
    href: string;
  };

  export type LinkProps = InternalLinkProps | ExternalLinkProps;
</script>

<script lang="ts">
  import { page } from '$app/state';
  import { cn } from '../utilities/cn.js';
  import { resolveHref } from '../utilities/resolve-href.js';

  let {
    variant = 'default',
    class: className,
    exact = false,
    external = false,
    href,
    children,
    label,
    ...rest
  }: LinkProps = $props();

  const resolvedHref = $derived(external ? href : resolveHref(href));

  const activePath = $derived.by(() => {
    if (!resolvedHref || external) return null;
    try {
      return new URL(resolvedHref, page.url).pathname;
    } catch (err) {
      console.error('Failed to resolve href', err);
      return null;
    }
  });

  const isActive = $derived.by(() => {
    if (!activePath) return false;
    const currentPath = page.url.pathname;
    if (exact) {
      return currentPath === activePath;
    }
    return currentPath === activePath || currentPath.startsWith(`${activePath}/`);
  });

  const externalProps = $derived(
    external
      ? {
          target: '_blank' as const,
          rel: 'noopener noreferrer',
        }
      : {},
  );
</script>

<a
  href={resolvedHref}
  class={cn('link', className)}
  data-active={isActive}
  data-variant={variant}
  aria-current={isActive ? 'page' : undefined}
  {...externalProps}
  {...rest}
>
  {#if children}{@render children()}{:else if label}{label}{/if}
</a>

<style>
  .link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-base);
    text-decoration: underline;
    text-decoration-thickness: max(1px, 0.0625em);
    text-underline-offset: 4px;
    border-radius: var(--radius-sm);
    transition: color var(--duration-fast) var(--ease-standard);
  }

  .link:focus-visible {
    outline: 2px solid transparent;
    box-shadow:
      0 0 0 var(--ring-offset) var(--ring-offset-color),
      0 0 0 calc(var(--ring-offset) + var(--ring-width)) var(--link-ring, var(--control-ring-color));
  }

  .link:hover {
    text-decoration-thickness: max(2px, 0.125em);
  }

  /* Variant: default */
  .link[data-variant='default'] {
    --link-ring: var(--accent);
    color: var(--accent);
  }

  .link[data-variant='default']:hover {
    color: color-mix(in oklch, var(--accent), black 20%);
  }

  .link[data-variant='default'][data-active='true'] {
    text-decoration-thickness: max(2px, 0.125em);
  }

  /* Variant: muted */
  .link[data-variant='muted'] {
    color: var(--text-muted);
  }

  .link[data-variant='muted']:hover {
    color: var(--text);
  }

  .link[data-variant='muted'][data-active='true'] {
    color: var(--text);
    text-decoration-thickness: max(2px, 0.125em);
  }
</style>
