import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SkipLinks from './skip-links.svelte';

// The skip link is `cinder-sr-only-focusable`: visually hidden until it (or a
// descendant) gains keyboard focus, per the standard skip-link pattern (only
// `:focus-visible`, not bare `:focus`, reveals it). A plain `.click()` fails
// Playwright's actionability check because the link is genuinely off-screen
// until focused, so tests focus it directly first — links are always
// `:focus-visible` on focus in Chromium, matching how a keyboard user tabbing
// to it would reveal the same element — before clicking.
function focusSkipLink() {
  page.getByRole('link', { name: 'Skip to main content' }).element().focus();
}

describe('SkipLinks', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    const main = document.createElement('main');
    main.id = 'main-content';
    main.tabIndex = -1;
    document.body.appendChild(main);
  });

  it('renders a link that says "Skip to main content"', async () => {
    render(SkipLinks);
    const link = page.getByRole('link', { name: 'Skip to main content' });
    await expect.element(link).toBeInTheDocument();
    await expect.element(link).toHaveAttribute('href', '#main-content');
  });

  it('focuses #main-content when the skip link is clicked', async () => {
    render(SkipLinks);
    const main = document.getElementById('main-content')!;

    focusSkipLink();
    await page.getByRole('link', { name: 'Skip to main content' }).click();

    expect(document.activeElement).toBe(main);
  });

  it('removes the tabindex attribute after #main-content blurs (when no original tabindex)', async () => {
    const main = document.getElementById('main-content')!;
    main.removeAttribute('tabindex');

    render(SkipLinks);
    focusSkipLink();
    await page.getByRole('link', { name: 'Skip to main content' }).click();
    main.blur();

    expect(main.hasAttribute('tabindex')).toBe(false);
  });

  it('restores the original tabindex value after blur', async () => {
    const main = document.getElementById('main-content')!;
    main.setAttribute('tabindex', '0');

    render(SkipLinks);
    focusSkipLink();
    await page.getByRole('link', { name: 'Skip to main content' }).click();
    main.blur();

    expect(main.getAttribute('tabindex')).toBe('0');
  });
});
