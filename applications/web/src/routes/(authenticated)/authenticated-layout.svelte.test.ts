import { createRawSnippet } from 'svelte';
import { page as browserPage } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import AuthenticatedLayout from './+layout.svelte';
import type { LayoutData } from './$types';

const mocks = vi.hoisted(() => ({
  svelteKitPage: {
    url: new URL('http://localhost/repositories'),
  },
}));

vi.mock('$app/state', () => ({
  page: mocks.svelteKitPage,
}));

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<p>Routed content</p>',
}));

const baseData = {
  user: {
    id: 1,
    username: 'octocat',
    name: 'Octo Cat',
    avatarUrl: null,
    email: 'octocat@example.com',
    isPlatformAdministrator: false,
  },
  reviewsEnabled: true,
} satisfies LayoutData;

// MediaQuery reads window.matchMedia directly, so stub it with a fake
// MediaQueryList the test controls, rather than actually resizing the
// browser window under test.
class FakeMediaQueryList extends EventTarget {
  matches = true;
}

// The browser test viewport is narrower than Cinder's sidebar breakpoint
// (SIDEBAR_MOBILE_MEDIA_QUERY), so the Sidebar renders as a closed mobile
// Drawer by default and its contents (nav, footer) are not mounted until
// opened. Open it first so the nav items and footer become queryable.
const openMobileDrawer = async () => {
  await browserPage.getByRole('button', { name: 'Open navigation menu' }).click();
};

describe('(authenticated) layout', () => {
  afterEach(() => cleanup());

  it('marks the repositories nav item active on the repositories route', async () => {
    mocks.svelteKitPage.url = new URL('http://localhost/repositories');

    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });
    await openMobileDrawer();

    await expect
      .element(browserPage.getByRole('link', { name: /Repositories/ }))
      .toHaveAttribute('aria-current', 'page');
  });

  it('marks the agents nav item active on a nested agents route', async () => {
    mocks.svelteKitPage.url = new URL('http://localhost/agents/agent_1');

    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });
    await openMobileDrawer();

    await expect
      .element(browserPage.getByRole('link', { name: /Agents/ }))
      .toHaveAttribute('aria-current', 'page');
  });

  it('marks the runs, webhooks, costs, and settings nav items active on their routes', async () => {
    mocks.svelteKitPage.url = new URL('http://localhost/costs');

    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });
    await openMobileDrawer();

    await expect
      .element(browserPage.getByRole('link', { name: /Costs/ }))
      .toHaveAttribute('aria-current', 'page');
  });

  it('hides the workflows nav item for a non-administrator', async () => {
    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });
    await openMobileDrawer();

    await expect
      .element(browserPage.getByRole('link', { name: /Workflows/ }))
      .not.toBeInTheDocument();
  });

  it('shows the workflows nav item for a platform administrator', async () => {
    mocks.svelteKitPage.url = new URL('http://localhost/workflow-inspector');

    render(AuthenticatedLayout, {
      data: { ...baseData, user: { ...baseData.user, isPlatformAdministrator: true } },
      children: childrenSnippet,
      params: {},
    });
    await openMobileDrawer();

    await expect
      .element(browserPage.getByRole('link', { name: /Workflows/ }))
      .toHaveAttribute('aria-current', 'page');
  });

  it('shows reviews active status when reviews are enabled', async () => {
    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });
    await openMobileDrawer();

    await expect.element(browserPage.getByText('Reviews active').first()).toBeVisible();
  });

  it('shows reviews paused status when reviews are disabled', async () => {
    render(AuthenticatedLayout, {
      data: { ...baseData, reviewsEnabled: false },
      children: childrenSnippet,
      params: {},
    });
    await openMobileDrawer();

    await expect.element(browserPage.getByText('Reviews paused').first()).toBeVisible();
  });

  it('renders the routed children inside the main landmark', async () => {
    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });

    await expect.element(browserPage.getByText('Routed content')).toBeVisible();
  });

  it('opens the mobile drawer when the hamburger button is clicked', async () => {
    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });

    const menuButton = browserPage.getByRole('button', { name: 'Open navigation menu' });
    await expect.element(menuButton).toHaveAttribute('aria-expanded', 'false');

    await menuButton.click();

    await expect.element(menuButton).toHaveAttribute('aria-expanded', 'true');
  });

  it('re-syncs the collapsed state when the sidebar breakpoint is crossed', async () => {
    const fakeMediaQueryList = new FakeMediaQueryList();
    const matchMediaSpy = vi
      .spyOn(window, 'matchMedia')
      .mockReturnValue(fakeMediaQueryList as unknown as MediaQueryList);

    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });

    const menuButton = browserPage.getByRole('button', { name: 'Open navigation menu' });
    // Starts narrow (matches=true) → drawer closed.
    await expect.element(menuButton).toHaveAttribute('aria-expanded', 'false');

    // Cross the breakpoint to desktop width; the effect re-syncs collapsed to
    // the new viewport instead of leaving it at its last manually-toggled value.
    fakeMediaQueryList.matches = false;
    fakeMediaQueryList.dispatchEvent(new Event('change'));

    await expect.element(menuButton).toHaveAttribute('aria-expanded', 'true');

    matchMediaSpy.mockRestore();
  });
});
