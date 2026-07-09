import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import SettingsPage from './+page.svelte';
import type { PageProps } from './$types';

const user = {
  id: 1,
  username: 'testuser',
  name: 'Test User',
  avatarUrl: null,
  email: 'test@example.com',
  isPlatformAdministrator: false,
};

const baseData = {
  user,
  reviewsEnabled: true,
  settings: {
    userId: 1,
    dailyCostCapUsd: '5',
    defaultModel: 'sonnet',
    reviewsEnabled: true,
    updatedAt: new Date('2026-06-18T12:00:00Z'),
  },
  modelOptions: ['sonnet', 'opus'],
  surfaceStates: [],
} satisfies PageProps['data'];

// The switch's accessible name stays stable ("Reviews enabled") across
// states — aria-checked communicates on/off, per the WAI-ARIA switch
// pattern. The dangerous *direction* of the action is communicated
// separately, by the confirm dialog and its "Pause reviews" button.
function killSwitchToggle() {
  return page.getByRole('switch', { name: 'Reviews enabled' });
}

function hiddenReviewsEnabledInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[name="reviewsEnabled"]');
  expect(input).toBeInstanceOf(HTMLInputElement);
  return input as HTMLInputElement;
}

describe('/settings page — kill switch danger zone', () => {
  afterEach(() => cleanup());

  it('renders the enabled state as a safe, active status', async () => {
    render(SettingsPage, { data: baseData, form: null, params: {} });

    await expect.element(page.getByRole('heading', { name: 'Kill switch' })).toBeVisible();
    await expect.element(page.getByText('Danger zone')).toBeVisible();
    await expect.element(page.getByText('Reviews active')).toBeVisible();
    await expect
      .element(page.getByText('stops new run and automation dispatch across every repository'))
      .toBeVisible();
    await expect.element(killSwitchToggle()).toHaveAttribute('aria-checked', 'true');
    // The hidden checkbox that actually submits with the form mirrors the
    // visible switch state, so a save posts the value the user sees.
    expect(hiddenReviewsEnabledInput().checked).toBe(true);
  });

  it('renders the paused state as a visibly dangerous status', async () => {
    render(SettingsPage, {
      data: { ...baseData, settings: { ...baseData.settings, reviewsEnabled: false } },
      form: null,
      params: {},
    });

    await expect.element(page.getByText('Reviews paused')).toBeVisible();
    await expect.element(killSwitchToggle()).toHaveAttribute('aria-checked', 'false');
    expect(hiddenReviewsEnabledInput().checked).toBe(false);
    // Turning reviews back on is a normal save — no unsaved-change badge yet
    // because the saved and staged values match.
    await expect.element(page.getByText('Unsaved change')).not.toBeInTheDocument();
  });

  it('requires confirmation before staging a paused state, and shows the staged/unsaved state', async () => {
    render(SettingsPage, { data: baseData, form: null, params: {} });

    await killSwitchToggle().click();

    // Confirmation dialog appears; the toggle has not flipped yet.
    await expect.element(page.getByRole('dialog', { name: 'Pause reviews?' })).toBeInTheDocument();
    await expect.element(killSwitchToggle()).toHaveAttribute('aria-checked', 'true');
    expect(hiddenReviewsEnabledInput().checked).toBe(true);

    await page.getByRole('button', { name: 'Pause reviews' }).click();

    // Confirmed: the toggle — and the hidden field the form actually submits
    // — now reflect the staged (unsaved) paused state.
    await expect.element(page.getByText('Reviews paused')).toBeVisible();
    await expect.element(killSwitchToggle()).toHaveAttribute('aria-checked', 'false');
    expect(hiddenReviewsEnabledInput().checked).toBe(false);
    await expect.element(page.getByText('Unsaved change')).toBeVisible();
  });

  it('cancelling the confirmation leaves reviews enabled', async () => {
    render(SettingsPage, { data: baseData, form: null, params: {} });

    await killSwitchToggle().click();
    await expect.element(page.getByRole('dialog', { name: 'Pause reviews?' })).toBeInTheDocument();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect.element(page.getByText('Reviews active')).toBeVisible();
    await expect.element(killSwitchToggle()).toHaveAttribute('aria-checked', 'true');
    expect(hiddenReviewsEnabledInput().checked).toBe(true);
    await expect.element(page.getByText('Unsaved change')).not.toBeInTheDocument();
  });

  it('turning reviews back on does not require confirmation', async () => {
    render(SettingsPage, {
      data: { ...baseData, settings: { ...baseData.settings, reviewsEnabled: false } },
      form: null,
      params: {},
    });

    await killSwitchToggle().click();

    await expect
      .element(page.getByRole('dialog', { name: 'Pause reviews?' }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText('Reviews active')).toBeVisible();
    expect(hiddenReviewsEnabledInput().checked).toBe(true);
    await expect.element(page.getByText('Unsaved change')).toBeVisible();
  });

  it('shows a save error without hiding the current kill switch state', async () => {
    // A failed save (e.g. an invalid cost cap) reloads the page's `load` data,
    // which reflects whatever is actually persisted — here, a paused setting
    // saved on an earlier request. The error must render alongside it, not
    // instead of it.
    render(SettingsPage, {
      data: { ...baseData, settings: { ...baseData.settings, reviewsEnabled: false } },
      form: { error: 'Daily cost cap must be a non-negative number.' },
      params: {},
    });

    await expect
      .element(page.getByText('Daily cost cap must be a non-negative number.'))
      .toBeVisible();
    await expect.element(page.getByText('Reviews paused')).toBeVisible();
    await expect.element(killSwitchToggle()).toHaveAttribute('aria-checked', 'false');
    expect(hiddenReviewsEnabledInput().checked).toBe(false);
  });
});
