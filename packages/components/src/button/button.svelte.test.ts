import { page } from 'vitest/browser';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'vitest-browser-svelte';
import Button from './button.svelte';
import { expectNoA11yViolations } from '@tribunal/test/accessibility';

describe('Button', () => {
  afterEach(() => {
    cleanup();
  });

  describe('disabled state', () => {
    it('applies disabled attribute to button', async () => {
      render(Button, { label: 'Test', disabled: true });
      const button = page.getByRole('button', { name: 'Test' });
      await expect.element(button).toBeDisabled();
    });

    it('applies aria-disabled to link buttons', async () => {
      render(Button, { label: 'Test', disabled: true, href: '/test' });
      const link = page.getByRole('link', { name: 'Test' });
      await expect.element(link).toHaveAttribute('aria-disabled', 'true');
    });

    it('is disabled when loading', async () => {
      render(Button, { label: 'Test', loading: true });
      const button = page.getByRole('button', { name: 'Test' });
      await expect.element(button).toBeDisabled();
      await expect.element(button).toHaveAttribute('aria-busy', 'true');
    });
  });

  describe('variants', () => {
    it.each(['primary', 'secondary', 'danger', 'ghost'] as const)(
      'renders %s variant with data-variant attribute',
      async (variant) => {
        render(Button, { label: 'Test', variant });
        const button = page.getByRole('button', { name: 'Test' });
        await expect.element(button).toHaveAttribute('data-variant', variant);
      },
    );
  });

  describe('sizes', () => {
    it.each(['xs', 'sm', 'md', 'lg'] as const)(
      'renders %s size with data-size attribute',
      async (size) => {
        render(Button, { label: 'Test', size });
        const button = page.getByRole('button', { name: 'Test' });
        await expect.element(button).toHaveAttribute('data-size', size);
      },
    );
  });

  describe('as link', () => {
    it('renders as anchor with href', async () => {
      render(Button, { label: 'Link', href: '/test' });
      const link = page.getByRole('link', { name: 'Link' });
      await expect.element(link).toHaveAttribute('href', '/test');
    });

    it('adds external link attributes when external is true', async () => {
      render(Button, { label: 'External', href: 'https://example.com', external: true });
      const link = page.getByRole('link', { name: 'External' });
      await expect.element(link).toHaveAttribute('target', '_blank');
      await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  describe('a11y smoke', () => {
    it('a11y smoke: has no accessibility violations', async () => {
      render(Button, { label: 'Submit' });

      await expectNoA11yViolations();
    });
  });
});
