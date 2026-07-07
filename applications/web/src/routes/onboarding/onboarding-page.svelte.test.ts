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

  function currentStepText(): string | null {
    const currentStep = document.querySelector('.cinder-steps__item[aria-current="step"]');
    const index = currentStep?.querySelector('.cinder-steps__index')?.textContent?.trim();
    const label = currentStep?.querySelector('.cinder-steps__label')?.textContent?.trim();

    return index && label ? `${index} ${label}` : null;
  }

  function completedStepLabels(): string[] {
    return Array.from(
      document.querySelectorAll('.cinder-steps__item[data-cinder-state="complete"]'),
    ).map((element) => element.querySelector('.cinder-steps__label')?.textContent?.trim() ?? '');
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
    expect(currentStepText()).toBe('3 Choose repositories to watch');
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
      .element(page.getByRole('heading', { name: 'Choose repositories to watch' }))
      .toBeInTheDocument();
    // Exact + case-sensitive so this resolves to the repo-name span only, not
    // the "Tribunal" wordmark or the surrounding prose.
    await expect.element(page.getByText('tribunal', { exact: true })).toBeInTheDocument();
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
});
