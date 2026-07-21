import { createRawSnippet } from 'svelte';
import { page as browserPage } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import Cat from 'lucide-svelte/icons/cat';
import Page from './page.svelte';

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
});
