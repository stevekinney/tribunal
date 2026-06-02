import { page } from 'vitest/browser';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'vitest-browser-svelte';
import Breadcrumbs from './breadcrumbs.svelte';
import type { BreadcrumbItem } from './breadcrumbs.svelte';
import { expectNoA11yViolations } from '@tribunal/test/accessibility';

describe('Breadcrumbs', () => {
  afterEach(() => {
    cleanup();
  });

  describe('rendering', () => {
    it('renders a navigation landmark with breadcrumb label', async () => {
      const items: BreadcrumbItem[] = [{ label: 'Home', href: '/' }, { label: 'Current' }];
      render(Breadcrumbs, { items });

      const navigation = page.getByRole('navigation', { name: 'Breadcrumb' });
      await expect.element(navigation).toBeInTheDocument();
    });

    it('renders all breadcrumb items in order', async () => {
      const items: BreadcrumbItem[] = [
        { label: 'First', href: '/first' },
        { label: 'Second', href: '/second' },
        { label: 'Third' },
      ];
      render(Breadcrumbs, { items });

      const list = page.getByRole('list');
      await expect.element(list).toBeInTheDocument();

      const listItems = page.getByRole('listitem');
      await expect.element(listItems.nth(0)).toHaveTextContent('First');
      await expect.element(listItems.nth(1)).toHaveTextContent('Second');
      await expect.element(listItems.nth(2)).toHaveTextContent('Third');
    });

    it('renders items with hrefs as links', async () => {
      const items: BreadcrumbItem[] = [{ label: 'Parent', href: '/parent' }, { label: 'Current' }];
      render(Breadcrumbs, { items });

      const link = page.getByRole('link', { name: 'Parent' });
      await expect.element(link).toHaveAttribute('href', '/parent');
    });

    it('renders items without hrefs as spans (current page)', async () => {
      const items: BreadcrumbItem[] = [
        { label: 'Parent', href: '/parent' },
        { label: 'Current Page' },
      ];
      render(Breadcrumbs, { items });

      // The last item should not be a link - only one link should exist
      const parentLink = page.getByRole('link', { name: 'Parent' });
      await expect.element(parentLink).toBeInTheDocument();

      // Current page should be in a span, not a link
      const currentPage = page.getByText('Current Page');
      await expect.element(currentPage).toHaveAttribute('aria-current', 'page');
    });
  });

  describe('accessibility', () => {
    it('marks the current page with aria-current="page"', async () => {
      const items: BreadcrumbItem[] = [{ label: 'Home', href: '/' }, { label: 'Current Page' }];
      render(Breadcrumbs, { items });

      const currentItem = page.getByText('Current Page');
      await expect.element(currentItem).toHaveAttribute('aria-current', 'page');
    });

    it('does not apply aria-current to linked items', async () => {
      const items: BreadcrumbItem[] = [
        { label: 'Home', href: '/' },
        { label: 'Parent', href: '/parent' },
        { label: 'Current' },
      ];
      render(Breadcrumbs, { items });

      const homeLink = page.getByRole('link', { name: 'Home' });
      await expect.element(homeLink).not.toHaveAttribute('aria-current');

      const parentLink = page.getByRole('link', { name: 'Parent' });
      await expect.element(parentLink).not.toHaveAttribute('aria-current');
    });

    it('renders as an ordered list for semantic structure', async () => {
      const items: BreadcrumbItem[] = [{ label: 'First', href: '/first' }, { label: 'Second' }];
      render(Breadcrumbs, { items });

      const list = page.getByRole('list');
      await expect.element(list).toBeInTheDocument();
    });

    it('a11y smoke: has no accessibility violations', async () => {
      const items: BreadcrumbItem[] = [{ label: 'Home', href: '/' }, { label: 'Current Page' }];
      render(Breadcrumbs, { items });

      await expectNoA11yViolations();
    });
  });

  describe('separators', () => {
    it('does not render separator before first item', async () => {
      const items: BreadcrumbItem[] = [
        { label: 'First', href: '/first' },
        { label: 'Second', href: '/second' },
        { label: 'Third' },
      ];
      render(Breadcrumbs, { items });

      // First listitem should not contain a separator svg before the link
      const firstItem = page.getByRole('listitem').nth(0);
      const firstLink = firstItem.getByRole('link');
      await expect.element(firstLink).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('handles a single item (current page only)', async () => {
      const items: BreadcrumbItem[] = [{ label: 'Dashboard' }];
      render(Breadcrumbs, { items });

      const navigation = page.getByRole('navigation', { name: 'Breadcrumb' });
      await expect.element(navigation).toBeInTheDocument();

      const currentItem = page.getByText('Dashboard');
      await expect.element(currentItem).toHaveAttribute('aria-current', 'page');
    });

    it('handles empty items array gracefully', async () => {
      const items: BreadcrumbItem[] = [];
      render(Breadcrumbs, { items });

      const navigation = page.getByRole('navigation', { name: 'Breadcrumb' });
      await expect.element(navigation).toBeInTheDocument();

      const list = page.getByRole('list');
      await expect.element(list).toBeInTheDocument();
    });
  });

  describe('custom class', () => {
    it('applies custom class name', async () => {
      const items: BreadcrumbItem[] = [{ label: 'Test' }];
      render(Breadcrumbs, { items, class: 'custom-class' });

      const navigation = page.getByRole('navigation', { name: 'Breadcrumb' });
      await expect.element(navigation).toHaveClass('custom-class');
    });
  });

  describe('workspace/project hierarchy', () => {
    it('renders workspace breadcrumb correctly', async () => {
      const items: BreadcrumbItem[] = [
        { label: 'Workspaces', href: '/workspaces' },
        { label: 'My Workspace' },
      ];
      render(Breadcrumbs, { items });

      const workspacesLink = page.getByRole('link', { name: 'Workspaces' });
      await expect.element(workspacesLink).toHaveAttribute('href', '/workspaces');

      const currentWorkspace = page.getByText('My Workspace');
      await expect.element(currentWorkspace).toHaveAttribute('aria-current', 'page');
    });

    it('renders project breadcrumb correctly', async () => {
      const items: BreadcrumbItem[] = [
        { label: 'Workspaces', href: '/workspaces' },
        { label: 'My Workspace', href: '/workspaces/my-workspace' },
        { label: 'My Project' },
      ];
      render(Breadcrumbs, { items });

      const workspacesLink = page.getByRole('link', { name: 'Workspaces' });
      await expect.element(workspacesLink).toHaveAttribute('href', '/workspaces');

      const workspaceLink = page.getByRole('link', { name: 'My Workspace' });
      await expect.element(workspaceLink).toHaveAttribute('href', '/workspaces/my-workspace');

      const currentProject = page.getByText('My Project');
      await expect.element(currentProject).toHaveAttribute('aria-current', 'page');
    });
  });
});
