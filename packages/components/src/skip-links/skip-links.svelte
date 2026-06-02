<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';

  export type SkipLinkTarget = {
    /** Target element ID (without #) */
    id: string;
    /** Display label */
    label: string;
  };

  export type SkipLinksProps = Omit<HTMLAttributes<HTMLDivElement>, 'class'> & {
    class?: string;
    /** Array of skip links - defaults to main-content only */
    links?: SkipLinkTarget[];
  };
</script>

<script lang="ts">
  import { cn } from '../utilities/cn.js';

  const DEFAULT_LINKS: SkipLinkTarget[] = [{ id: 'main-content', label: 'Skip to main content' }];

  let { class: className, links = DEFAULT_LINKS, ...rest }: SkipLinksProps = $props();

  function getScrollBehavior(): ScrollBehavior {
    if (typeof window !== 'undefined') {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      return prefersReducedMotion ? 'auto' : 'smooth';
    }
    return 'auto';
  }

  function handleClick(event: MouseEvent, targetId: string) {
    const element = document.getElementById(targetId);
    if (element) {
      event.preventDefault();

      // Check if we're already processing this element (i.e., tabindex is already '-1')
      const currentTabIndex = element.getAttribute('tabindex');
      if (currentTabIndex === '-1' && element === document.activeElement) {
        // Already focused from a previous click, just scroll again
        element.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' });
        return;
      }

      // Store the original tabindex before any modifications
      const originalTabIndex = currentTabIndex;
      element.setAttribute('tabindex', '-1');
      element.focus();
      element.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' });

      // Restore original tabindex (or remove if none existed) after blur
      element.addEventListener(
        'blur',
        () => {
          if (originalTabIndex !== null) {
            element.setAttribute('tabindex', originalTabIndex);
          } else {
            element.removeAttribute('tabindex');
          }
        },
        { once: true },
      );
    }
  }
</script>

<div class={cn('skip-links', className)} {...rest}>
  {#each links as link (link.id)}
    <a href="#{link.id}" class="skip-link" onclick={(e) => handleClick(e, link.id)}>
      {link.label}
    </a>
  {/each}
</div>

<style>
  .skip-links {
    position: fixed;
    top: 0;
    left: 0;
    z-index: calc(var(--z-overlay) + 10);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
  }

  .skip-link {
    position: absolute;
    left: -9999px;
    padding: var(--space-2) var(--space-4);
    background: var(--surface-overlay);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    text-decoration: none;
    white-space: nowrap;
    box-shadow: var(--shadow-lg);
  }

  .skip-link:focus {
    position: static;
    outline: 2px solid transparent;
    box-shadow:
      0 0 0 var(--ring-offset) var(--ring-offset-color),
      0 0 0 calc(var(--ring-offset) + var(--ring-width)) var(--ring-color),
      var(--shadow-lg);
  }
</style>
