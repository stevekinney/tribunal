import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import TermsOfUsePage from './+page.svelte';

describe('/terms-of-use page', () => {
  afterEach(() => cleanup());

  it('renders the terms of use heading and content', async () => {
    render(TermsOfUsePage);

    await expect.element(page.getByRole('heading', { name: 'Terms of Use' })).toBeVisible();
    await expect.element(page.getByText('Acceptance of terms')).toBeVisible();
  });
});
