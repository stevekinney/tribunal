import { createRawSnippet } from 'svelte';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import RootLayout from './+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<p>Routed content</p>',
}));

describe('root layout', () => {
  afterEach(() => cleanup());

  it('renders the routed children and sets the document title', async () => {
    render(RootLayout, { children: childrenSnippet });

    await expect.element(page.getByText('Routed content')).toBeVisible();
    await expect.poll(() => document.title).toBe('Tribunal');
  });
});
