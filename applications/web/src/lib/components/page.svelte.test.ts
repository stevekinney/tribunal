import { createRawSnippet } from 'svelte';
import { page as browserPage } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import Cat from 'lucide-svelte/icons/cat';
import Page from './page.svelte';
import PageMultiActionFixture from './page-multi-action-fixture.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<p>Body content</p>',
}));

describe('Page', () => {
  afterEach(() => cleanup());

  it('renders the title, description, and children', async () => {
    render(Page, {
      title: 'Repositories',
      description: 'Manage watched repositories.',
      children: childrenSnippet,
    });

    await expect.element(browserPage.getByRole('heading', { name: 'Repositories' })).toBeVisible();
    await expect.element(browserPage.getByText('Body content')).toBeVisible();
  });

  it('renders a leading icon when one is provided', async () => {
    render(Page, {
      title: 'Agents',
      // lucide-svelte icon components predate Svelte 5's Component type;
      // the cast is test-only looseness for a render prop.
      icon: Cat as unknown as import('svelte').Component,
      children: childrenSnippet,
    });

    const heading = browserPage.getByRole('heading', { name: 'Agents' });
    await expect.element(heading).toBeVisible();
    const container = document.querySelector('.page-icon-container');
    expect(container?.querySelector('svg')).toBeTruthy();
  });

  // Regression test for the "canyon of whitespace" / "scattered action row"
  // complaint: an actions snippet with several sibling root nodes (e.g. a
  // Link followed by three Buttons, as on the pull-requests page) used to
  // become several independent flex items in `.page-header-row`, which
  // `justify-content: space-between` spread evenly across the whole row
  // instead of clustering them together on the right. `createRawSnippet`
  // cannot construct a multi-root snippet (its `render` must return a single
  // element), so this uses a small fixture component with a real multi-node
  // `{#snippet actions()}` block instead.
  it('wraps a multi-node actions snippet in a single flex item instead of scattering it', async () => {
    const { container } = render(PageMultiActionFixture, {
      children: childrenSnippet,
    });

    const row = container.querySelector('.page-header-row');
    const actionsWrapper = container.querySelector('.page-header-actions');
    expect(actionsWrapper).toBeTruthy();

    // Before the fix, every one of the snippet's root nodes (a Link and two
    // Buttons here) became an independent flex item alongside the leading
    // title group — four siblings for `justify-content: space-between` to
    // spread across the whole row. Now the row has exactly two flex items
    // (leading group, actions wrapper), and every action node lives inside
    // the wrapper instead.
    expect(row?.children.length).toBe(2);
    expect(actionsWrapper?.children.length).toBe(3);
  });
});
