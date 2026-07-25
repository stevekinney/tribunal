import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import LogoutPage from './+page.svelte';

describe('/logout page', () => {
  afterEach(() => cleanup());

  it('renders a signing-out message', async () => {
    render(LogoutPage);

    await expect.element(page.getByText('Signing out...')).toBeVisible();
  });
});
