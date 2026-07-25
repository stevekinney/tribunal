import { createRawSnippet } from 'svelte';
import { page as browserPage } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import AuthenticatedLayout from './+layout.svelte';
import type { LayoutData } from './$types';

const mocks = vi.hoisted(() => ({
  svelteKitPage: {
    url: new URL('http://localhost/repositories'),
  },
  getNeonAuthClient: vi.fn(),
  startNeonSessionRefresh: vi.fn(),
  broadcastNeonSessionLogout: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: mocks.svelteKitPage,
}));

// This layout is only ever rendered for a signed-in user (the server load
// redirects otherwise), so it starts a periodic Neon Auth session refresh on
// mount, and its footer renders UserMenu (which wires the sign-out form's
// broadcastNeonSessionLogout call). These tests aren't exercising that Neon
// Auth wiring itself (see neon-client.test.ts and user-menu.svelte.test.ts)
// -- mock it out so nav/sidebar assertions don't depend on
// PUBLIC_NEON_AUTH_URL being configured in this browser test environment.
vi.mock('$lib/auth/neon-client', () => ({
  getNeonAuthClient: mocks.getNeonAuthClient,
  startNeonSessionRefresh: mocks.startNeonSessionRefresh,
  broadcastNeonSessionLogout: mocks.broadcastNeonSessionLogout,
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

const expectSidebarReviewStatus = async (label: string) => {
  const labels = browserPage.getByText(label, { exact: true });
  await expect.element(labels).toHaveLength(1);
  await expect.element(labels.first()).toBeVisible();
};

type SessionRefreshOptions = {
  onResumeRefreshPendingChange?: (pending: boolean) => void;
};

function latestSessionRefreshOptions(): SessionRefreshOptions {
  const call = mocks.startNeonSessionRefresh.mock.calls.at(-1);
  if (!call) throw new Error('Expected startNeonSessionRefresh to be called.');
  return call[1] as SessionRefreshOptions;
}

describe('(authenticated) layout', () => {
  beforeEach(() => {
    mocks.getNeonAuthClient.mockReset().mockReturnValue({ getSession: vi.fn() });
    mocks.startNeonSessionRefresh.mockReset().mockReturnValue(vi.fn());
  });

  afterEach(async () => {
    cleanup();
    await browserPage.viewport(375, 667);
  });

  it('starts periodic Neon Auth session refresh on mount and stops it on unmount', async () => {
    const stopRefresh = vi.fn();
    const fakeClient = { getSession: vi.fn() };
    mocks.getNeonAuthClient.mockReturnValue(fakeClient);
    mocks.startNeonSessionRefresh.mockReturnValue(stopRefresh);

    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });

    await expect.poll(() => mocks.startNeonSessionRefresh.mock.calls.length).toBeGreaterThan(0);
    // Exactly once: the effect reads no reactive state, so it must not
    // re-run (and re-start the interval) for the life of the component.
    expect(mocks.startNeonSessionRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.startNeonSessionRefresh).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({ onResumeRefreshPendingChange: expect.any(Function) }),
    );
    expect(stopRefresh).not.toHaveBeenCalled();

    cleanup();

    await expect.poll(() => stopRefresh.mock.calls.length).toBeGreaterThan(0);
  });

  it('blocks the shell while a hidden-tab session resume refresh is pending', async () => {
    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });

    latestSessionRefreshOptions().onResumeRefreshPendingChange?.(true);
    await expect
      .element(browserPage.getByRole('status'))
      .toHaveTextContent('Restoring your session...');
    await expect.element(browserPage.getByTestId('session-resume-overlay')).toBeInTheDocument();

    latestSessionRefreshOptions().onResumeRefreshPendingChange?.(false);
    await expect.element(browserPage.getByTestId('session-resume-overlay')).not.toBeInTheDocument();
  });

  it('does not crash the shell when Neon Auth session refresh fails to start', async () => {
    mocks.getNeonAuthClient.mockImplementation(() => {
      throw new Error('PUBLIC_NEON_AUTH_URL is required to use Neon Auth');
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });

    await expect.element(browserPage.getByText('Routed content')).toBeVisible();
    await expect.poll(() => consoleErrorSpy.mock.calls.length).toBeGreaterThan(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to start Neon Auth session refresh',
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

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

    await expectSidebarReviewStatus('Reviews active');
  });

  it('shows reviews paused status when reviews are disabled', async () => {
    render(AuthenticatedLayout, {
      data: { ...baseData, reviewsEnabled: false },
      children: childrenSnippet,
      params: {},
    });
    await openMobileDrawer();

    await expectSidebarReviewStatus('Reviews paused');
  });

  it('renders the routed children inside the main landmark', async () => {
    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });

    await expect.element(browserPage.getByText('Routed content')).toBeVisible();
  });

  it('renders app-owned shell branding outside the Cinder Sidebar', async () => {
    await browserPage.viewport(1280, 720);

    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });

    const desktopBrand = document.querySelector('.desktop-sidebar-shell > .desktop-brand-link');

    if (!desktopBrand) {
      throw new Error('Expected desktop shell brand link.');
    }

    expect(desktopBrand.getAttribute('href')).toBe('/repositories');
    expect(desktopBrand.textContent?.trim()).toBe('Tribunal');
    expect(desktopBrand.closest('.cinder-sidebar')).toBeNull();
    await expect.element(browserPage.elementLocator(desktopBrand)).toBeVisible();
  });

  it('opens the mobile drawer from the Cinder mobile trigger', async () => {
    render(AuthenticatedLayout, { data: baseData, children: childrenSnippet, params: {} });

    const menuButton = browserPage.getByRole('button', { name: 'Open navigation menu' });
    await expect.element(menuButton).toHaveAttribute('aria-controls', 'app-sidebar');
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
