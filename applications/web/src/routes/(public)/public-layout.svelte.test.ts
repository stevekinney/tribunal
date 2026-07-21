import { createRawSnippet } from 'svelte';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import PublicLayout from './+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<p>Public route content</p>',
}));

describe('(public) layout', () => {
  afterEach(() => cleanup());

  it('renders a main landmark wrapping the routed children', async () => {
    render(PublicLayout, { children: childrenSnippet });

    const main = page.getByRole('main');
    await expect.element(main).toBeVisible();
    await expect.element(main).toHaveAttribute('id', 'main-content');
    await expect.element(page.getByText('Public route content')).toBeVisible();
  });
});
