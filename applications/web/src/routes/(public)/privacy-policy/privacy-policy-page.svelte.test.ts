import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import PrivacyPolicyPage from './+page.svelte';

describe('/privacy-policy page', () => {
  afterEach(() => cleanup());

  it('renders the privacy policy heading and content', async () => {
    render(PrivacyPolicyPage);

    await expect.element(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await expect.element(page.getByText('Information we collect')).toBeVisible();
  });
});
