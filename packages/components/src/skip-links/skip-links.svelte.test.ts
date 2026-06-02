import { page } from 'vitest/browser';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'vitest-browser-svelte';
import SkipLinks from './skip-links.svelte';
import { expectNoA11yViolations } from '@tribunal/test/accessibility';

describe('SkipLinks', () => {
  afterEach(() => {
    cleanup();
  });

  describe('rendering', () => {
    it('renders skip link elements', async () => {
      render(SkipLinks, {
        links: [{ id: 'main', label: 'Skip to main' }],
      });
      const link = page.getByRole('link', { name: 'Skip to main' });
      await expect.element(link).toBeInTheDocument();
    });

    it('renders default skip link when no links provided', async () => {
      render(SkipLinks);
      const link = page.getByRole('link', { name: 'Skip to main content' });
      await expect.element(link).toBeInTheDocument();
    });

    it('renders multiple skip links in order', async () => {
      render(SkipLinks, {
        links: [
          { id: 'main', label: 'Skip to main' },
          { id: 'nav', label: 'Skip to nav' },
        ],
      });
      const links = page.getByRole('link');
      await expect.element(links.nth(0)).toHaveTextContent('Skip to main');
      await expect.element(links.nth(1)).toHaveTextContent('Skip to nav');
    });
  });

  describe('link attributes', () => {
    it('has correct href pointing to target ID', async () => {
      render(SkipLinks, {
        links: [{ id: 'main-content', label: 'Skip to main' }],
      });
      const link = page.getByRole('link', { name: 'Skip to main' });
      await expect.element(link).toHaveAttribute('href', '#main-content');
    });

    it('applies custom class to container', async () => {
      render(SkipLinks, {
        links: [{ id: 'main', label: 'Skip' }],
        class: 'custom-class',
      });
      const link = page.getByRole('link', { name: 'Skip' });
      const container = link.element().parentElement;
      expect(container?.classList.contains('custom-class')).toBe(true);
    });
  });

  describe('accessibility', () => {
    it('skip links are accessible in DOM', async () => {
      render(SkipLinks, {
        links: [{ id: 'main', label: 'Skip to main content' }],
      });

      const link = page.getByRole('link', { name: 'Skip to main content' });
      await expect.element(link).toBeInTheDocument();
    });

    it('each link has proper href for anchor navigation', async () => {
      render(SkipLinks, {
        links: [
          { id: 'main', label: 'Skip to main' },
          { id: 'sidebar', label: 'Skip to sidebar' },
        ],
      });

      const mainLink = page.getByRole('link', { name: 'Skip to main' });
      const sidebarLink = page.getByRole('link', { name: 'Skip to sidebar' });

      await expect.element(mainLink).toHaveAttribute('href', '#main');
      await expect.element(sidebarLink).toHaveAttribute('href', '#sidebar');
    });
  });

  describe('a11y smoke', () => {
    it('a11y smoke: has no accessibility violations', async () => {
      render(SkipLinks, {
        links: [{ id: 'main', label: 'Skip to main content' }],
      });

      await expectNoA11yViolations();
    });
  });
});
