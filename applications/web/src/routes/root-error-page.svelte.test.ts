import { page as browserPage } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import RootErrorPage from './+error.svelte';

const mocks = vi.hoisted(() => ({
  svelteKitPage: {
    status: 404,
  },
}));

vi.mock('$app/state', () => ({
  page: mocks.svelteKitPage,
}));

describe('root error page', () => {
  afterEach(() => cleanup());

  it('renders a 404-specific heading and message', async () => {
    mocks.svelteKitPage.status = 404;

    render(RootErrorPage);

    await expect
      .element(browserPage.getByRole('heading', { name: 'Page Not Found' }))
      .toBeVisible();
    await expect
      .element(browserPage.getByText('The page you are looking for does not exist.'))
      .toBeVisible();
    await expect
      .element(browserPage.getByRole('link', { name: 'Return Home' }))
      .toHaveAttribute('href', '/');
  });

  it('renders a generic heading and message for non-404 statuses', async () => {
    mocks.svelteKitPage.status = 500;

    render(RootErrorPage);

    await expect
      .element(browserPage.getByRole('heading', { name: 'Something Went Wrong' }))
      .toBeVisible();
    await expect
      .element(browserPage.getByText('An unexpected error occurred. Please try again.'))
      .toBeVisible();
  });
});
