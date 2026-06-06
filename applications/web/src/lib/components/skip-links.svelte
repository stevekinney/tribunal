<script lang="ts">
  import { VisuallyHidden } from '@lostgradient/cinder/visually-hidden';

  const TARGET_ID = 'main-content';

  function getScrollBehavior(): ScrollBehavior {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    }
    return 'auto';
  }

  function handleClick(event: MouseEvent) {
    const element = document.getElementById(TARGET_ID);
    if (!element) return;

    event.preventDefault();

    const currentTabIndex = element.getAttribute('tabindex');
    if (currentTabIndex === '-1' && element === document.activeElement) {
      element.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' });
      return;
    }

    const originalTabIndex = currentTabIndex;
    element.setAttribute('tabindex', '-1');
    element.focus();
    element.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' });

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
</script>

<VisuallyHidden as="a" href="#{TARGET_ID}" focusable onclick={handleClick}>
  Skip to main content
</VisuallyHidden>
