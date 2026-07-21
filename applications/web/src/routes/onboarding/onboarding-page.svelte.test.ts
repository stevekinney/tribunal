import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import OnboardingPage from './+page.svelte';
import type { PageData } from './$types';

// invalidateAll backs the "Try again" retry on the transient-outage prompt;
// spy on it so the retry path is both exercised and asserted without a router.
const { invalidateAll } = vi.hoisted(() => ({ invalidateAll: vi.fn() }));
vi.mock('$app/navigation', () => ({ invalidateAll }));

describe('/onboarding page', () => {
  beforeEach(() => {
    invalidateAll.mockReset();
  });

  function onboardingStepItems(): HTMLElement[] {
    const navigation = document.querySelector('nav[aria-label="Onboarding steps"]');
    expect(navigation).toBeInstanceOf(HTMLElement);

    return Array.from(navigation?.querySelectorAll('li') ?? []);
  }

  function normalizedStepText(element: Element): string {
    return element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function currentStepText(): string | null {
    const currentStep = onboardingStepItems().find(
      (element) => element.getAttribute('aria-current') === 'step',
    );

    return currentStep ? normalizedStepText(currentStep) : null;
  }

  function completedStepLabels(): string[] {
    return onboardingStepItems()
      .map(normalizedStepText)
      .filter((text) => text.startsWith('Completed '))
      .map((text) => text.replace(/^Completed /, ''));
  }

  it('prompts the user to reconnect when the GitHub token is dead', async () => {
    const data = {
      repositories: [],
      installations: [],
      connectReason: 'disconnected',
    } satisfies PageData;

    render(OnboardingPage, { data, form: null, params: {} });

    await expect
      .element(page.getByRole('heading', { name: 'Reconnect your GitHub account' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'Reconnect GitHub' }))
      .toHaveAttribute('href', '/connect/github');
    expect(currentStepText()).toBe('1 Sign in with GitHub');
    expect(completedStepLabels()).toEqual([]);
  });

  it('offers a retry (not a reconnect link) on a transient GitHub outage', async () => {
    const data = {
      repositories: [],
      installations: [],
      connectReason: 'unavailable',
    } satisfies PageData;

    render(OnboardingPage, { data, form: null, params: {} });

    await expect
      .element(page.getByRole('heading', { name: 'Could not reach GitHub' }))
      .toBeInTheDocument();

    // A transient outage must NOT route to /connect/github — re-fetching the
    // existing (healthy) connection is the fix, so the CTA is a button.
    await page.getByRole('button', { name: 'Try again' }).click();
    expect(invalidateAll).toHaveBeenCalledTimes(1);
    expect(currentStepText()).toBe('1 Sign in with GitHub');
    expect(completedStepLabels()).toEqual([]);
  });

  it('prompts the user to install the app when no installation exists', async () => {
    const data = {
      repositories: [],
      installations: [],
      connectReason: 'no_installation',
    } satisfies PageData;

    render(OnboardingPage, { data, form: null, params: {} });

    await expect
      .element(page.getByRole('heading', { name: 'Install the GitHub App' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'Install GitHub App' }))
      .toHaveAttribute('href', '/connect/github');
    expect(currentStepText()).toBe('2 Install the GitHub App');
    expect(completedStepLabels()).toEqual(['Sign in with GitHub']);
  });

  it('prompts the user to grant repository access when installed but no repos exist', async () => {
    const data = {
      repositories: [],
      installations: [{ installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null }],
      connectReason: 'no_repositories',
    } satisfies PageData;

    render(OnboardingPage, { data, form: null, params: {} });

    await expect
      .element(page.getByRole('heading', { name: 'Grant repository access' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'Manage repository access' }))
      .toHaveAttribute('href', '/connect/github');
    expect(currentStepText()).toBe('3 Choose repositories to monitor');
    expect(completedStepLabels()).toEqual(['Sign in with GitHub', 'Install the GitHub App']);
  });

  it('renders the repository picker when the connection is healthy', async () => {
    const data = {
      repositories: [
        { id: 1, owner: 'test-org', name: 'tribunal', defaultBranch: 'main', watched: false },
      ],
      installations: [{ installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null }],
      connectReason: null,
    } satisfies PageData;

    render(OnboardingPage, { data, form: null, params: {} });

    await expect
      .element(page.getByRole('heading', { name: 'Add repositories to Tribunal' }))
      .toBeInTheDocument();
    // Exact + case-sensitive so this resolves to the repo-name span only, not
    // the "Tribunal" wordmark or the surrounding prose.
    await expect.element(page.getByText('tribunal', { exact: true })).toBeInTheDocument();

    // Copy talks about adding/monitoring repositories, not only enabling
    // reviews — repository access is useful for event-triggered automation
    // too, not just pull-request review dispatch.
    await expect
      .element(page.getByText('Pick the ones to add to Tribunal for monitoring and automation.'))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: 'Add 0 repositories' }))
      .toBeInTheDocument();
  });

  it('surfaces a batch-watch failure message on the picker', async () => {
    const data = {
      repositories: [
        { id: 1, owner: 'test-org', name: 'tribunal', defaultBranch: 'main', watched: false },
      ],
      installations: [{ installationId: 12345, accountLogin: 'test-org', accountAvatarUrl: null }],
      connectReason: null,
    } satisfies PageData;

    render(OnboardingPage, {
      data,
      form: { error: 'Too many repositories selected.' },
      params: {},
    });

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Too many repositories selected.');
  });

  it('pre-selects already-watched repositories and shows a plural account label', async () => {
    const data = {
      repositories: [
        { id: 1, owner: 'test-org', name: 'tribunal', defaultBranch: 'main', watched: true },
        { id: 2, owner: 'test-org', name: 'widgets', defaultBranch: 'main', watched: false },
      ],
      installations: [
        { installationId: 1, accountLogin: 'test-org', accountAvatarUrl: null },
        { installationId: 2, accountLogin: 'other-org', accountAvatarUrl: null },
      ],
      connectReason: null,
    } satisfies PageData;

    render(OnboardingPage, { data, form: null, params: {} });

    await expect.element(page.getByRole('checkbox', { name: /tribunal/ })).toBeChecked();
    await expect
      .element(page.getByRole('button', { name: 'Add 1 repository' }))
      .toBeInTheDocument();
    await expect.element(page.getByText('2 accounts')).toBeInTheDocument();
  });

  it('adds and removes a repository from the selection when its checkbox is toggled', async () => {
    const data = {
      repositories: [
        { id: 1, owner: 'test-org', name: 'tribunal', defaultBranch: 'main', watched: false },
      ],
      installations: [],
      connectReason: null,
    } satisfies PageData;

    render(OnboardingPage, { data, form: null, params: {} });

    const checkbox = page.getByRole('checkbox', { name: /tribunal/ });
    await checkbox.click();
    await expect
      .element(page.getByRole('button', { name: 'Add 1 repository' }))
      .toBeInTheDocument();

    await checkbox.click();
    await expect
      .element(page.getByRole('button', { name: 'Add 0 repositories' }))
      .toBeInTheDocument();
  });

  it('filters the repository list by search query', async () => {
    const data = {
      repositories: [
        { id: 1, owner: 'test-org', name: 'tribunal', defaultBranch: 'main', watched: false },
        { id: 2, owner: 'test-org', name: 'widgets', defaultBranch: 'main', watched: false },
      ],
      installations: [],
      connectReason: null,
    } satisfies PageData;

    render(OnboardingPage, { data, form: null, params: {} });

    await page.getByRole('searchbox').fill('widgets');

    await expect.element(page.getByText('widgets', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('tribunal', { exact: true })).not.toBeInTheDocument();
  });

  it('shows a no-matches message when a search query matches no repositories', async () => {
    const data = {
      repositories: [
        { id: 1, owner: 'test-org', name: 'tribunal', defaultBranch: 'main', watched: false },
      ],
      installations: [],
      connectReason: null,
    } satisfies PageData;

    render(OnboardingPage, { data, form: null, params: {} });

    await page.getByRole('searchbox').fill('no-such-repo');

    await expect
      .element(page.getByText('No repositories matching "no-such-repo".'))
      .toBeInTheDocument();
  });

  it('shows a generic empty message when there are no repositories at all', async () => {
    const data = {
      repositories: [],
      installations: [],
      connectReason: null,
    } satisfies PageData;

    render(OnboardingPage, { data, form: null, params: {} });

    await expect.element(page.getByText('No repositories found.')).toBeInTheDocument();
  });

  it('falls back to the sign-in step for an unrecognized connect reason', async () => {
    const data = {
      repositories: [],
      installations: [],
      connectReason: 'some_future_reason' as any,
    } satisfies PageData;

    render(OnboardingPage, { data, form: null, params: {} });

    // The default switch arm treats unrecognized reasons as a healthy
    // connection (renders the picker) with the sign-in step highlighted.
    await expect
      .element(page.getByRole('heading', { name: 'Add repositories to Tribunal' }))
      .toBeInTheDocument();
    expect(currentStepText()).toBe('1 Sign in with GitHub');
  });
});
