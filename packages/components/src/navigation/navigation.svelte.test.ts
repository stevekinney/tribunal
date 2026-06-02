import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from 'vitest-browser-svelte';
import Navigation from './navigation.svelte';
import NavigationSeparator from './navigation-separator.svelte';

// Mock $app/state
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/dashboard'),
  },
}));

describe('Navigation', () => {
  beforeEach(() => {
    // Reset document body overflow
    document.body.style.overflow = '';
  });

  afterEach(() => cleanup());

  describe('rendering', () => {
    it('renders the navigation container', async () => {
      expect.assertions(1);
      render(Navigation);
      const nav = page.getByRole('navigation');
      await expect.element(nav).toBeInTheDocument();
    });

    it('has correct ARIA label', async () => {
      expect.assertions(1);
      render(Navigation);
      const nav = page.getByRole('navigation', { name: 'Main navigation' });
      await expect.element(nav).toBeInTheDocument();
    });
  });

  describe('mobile menu', () => {
    it('shows hamburger menu toggle', async () => {
      expect.assertions(1);
      render(Navigation);
      const toggleButton = page.getByRole('button', { name: /open menu/i });
      await expect.element(toggleButton).toBeInTheDocument();
    });

    it('toggle button has correct aria-expanded state initially', async () => {
      expect.assertions(1);
      render(Navigation);
      const toggleButton = page.getByRole('button', { name: /open menu/i });
      await expect.element(toggleButton).toHaveAttribute('aria-expanded', 'false');
    });

    it('toggle button has aria-controls pointing to mobile drawer', async () => {
      expect.assertions(1);
      render(Navigation);
      const toggleButton = page.getByRole('button', { name: /open menu/i });
      await expect.element(toggleButton).toHaveAttribute('aria-controls', 'navigation-drawer');
    });

    it('opens mobile menu when toggle is clicked', async () => {
      expect.assertions(1);
      render(Navigation);
      const toggleButton = page.getByRole('button', { name: /open menu/i });
      await toggleButton.click({ force: true });
      await expect.element(toggleButton).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes mobile menu when close button is clicked', async () => {
      expect.assertions(2);
      render(Navigation);

      // Open the menu first
      const toggleButton = page.getByRole('button', { name: /open menu/i });
      await toggleButton.click({ force: true });
      await expect.element(toggleButton).toHaveAttribute('aria-expanded', 'true');

      // Click close button inside the mobile menu
      const closeButton = page.getByRole('button', { name: /close menu/i });
      await closeButton.click({ force: true });

      await expect.element(toggleButton).toHaveAttribute('aria-expanded', 'false');
    });
  });
});

describe('NavigationSeparator', () => {
  afterEach(() => cleanup());

  it('renders with role="separator"', async () => {
    expect.assertions(1);
    render(NavigationSeparator);
    const separator = page.getByRole('separator');
    await expect.element(separator).toBeInTheDocument();
  });

  it('has horizontal orientation', async () => {
    expect.assertions(1);
    render(NavigationSeparator);
    const separator = page.getByRole('separator');
    await expect.element(separator).toHaveAttribute('aria-orientation', 'horizontal');
  });
});
