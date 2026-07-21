import { page as browserPage } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import AuthenticatedErrorPage from './+error.svelte';

const mocks = vi.hoisted(() => ({
  svelteKitPage: {
    error: null as unknown,
    status: 500,
  },
}));

vi.mock('$app/state', () => ({
  page: mocks.svelteKitPage,
}));

describe('(authenticated) error page', () => {
  afterEach(() => cleanup());

  it('falls back to a generic message when there is no error', async () => {
    mocks.svelteKitPage.error = null;
    mocks.svelteKitPage.status = 500;

    render(AuthenticatedErrorPage);

    await expect
      .element(browserPage.getByRole('heading', { name: 'Something went wrong' }))
      .toBeVisible();
    await expect.element(browserPage.getByText('An unexpected error occurred')).toBeVisible();
  });

  it('renders a string error message directly', async () => {
    mocks.svelteKitPage.error = 'Repository not found';
    mocks.svelteKitPage.status = 404;

    render(AuthenticatedErrorPage);

    await expect.element(browserPage.getByRole('heading', { name: 'Not Found' })).toBeVisible();
    await expect.element(browserPage.getByText('Repository not found')).toBeVisible();
  });

  it('renders an Error instance message', async () => {
    mocks.svelteKitPage.error = new Error('Something exploded');
    mocks.svelteKitPage.status = 500;

    render(AuthenticatedErrorPage);

    await expect.element(browserPage.getByText('Something exploded')).toBeVisible();
  });

  it('renders an App.Error-shaped object message', async () => {
    mocks.svelteKitPage.error = { message: 'No GitHub installation found' };
    mocks.svelteKitPage.status = 403;

    render(AuthenticatedErrorPage);

    await expect.element(browserPage.getByText('No GitHub installation found')).toBeVisible();
  });

  it('falls back to a generic message for an object without a message', async () => {
    mocks.svelteKitPage.error = { code: 'UNKNOWN' };
    mocks.svelteKitPage.status = 500;

    render(AuthenticatedErrorPage);

    await expect.element(browserPage.getByText('An unexpected error occurred')).toBeVisible();
  });

  it('offers to connect GitHub when the message reports a missing installation', async () => {
    mocks.svelteKitPage.error = 'No GitHub installation found for this account';
    mocks.svelteKitPage.status = 403;

    render(AuthenticatedErrorPage);

    await expect
      .element(browserPage.getByRole('link', { name: 'Connect GitHub' }))
      .toHaveAttribute('href', '/connect/github');
    await expect
      .element(browserPage.getByRole('link', { name: 'Go to repositories' }))
      .toHaveAttribute('href', '/repositories');
  });

  it('offers the default actions for a non-GitHub error', async () => {
    mocks.svelteKitPage.error = 'Database connection failed';
    mocks.svelteKitPage.status = 500;

    render(AuthenticatedErrorPage);

    await expect
      .element(browserPage.getByRole('link', { name: 'Go to repositories' }))
      .toHaveAttribute('href', '/repositories');
    await expect
      .element(browserPage.getByRole('link', { name: 'Home' }))
      .toHaveAttribute('href', '/');
  });
});
