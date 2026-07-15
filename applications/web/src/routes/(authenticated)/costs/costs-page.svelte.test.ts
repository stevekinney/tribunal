import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import CostsPage from './+page.svelte';
import type { PageData } from './$types';

const user = {
  id: 1,
  username: 'testuser',
  name: 'Test User',
  avatarUrl: null,
  email: 'test@example.com',
  isPlatformAdministrator: false,
};

const data = {
  user,
  costs: {
    source: 'estimate',
    dailyCostCapUsd: 10,
    todayTotalUsd: 2.5,
    rollups: {
      byReviewRun: [{ label: 'run_1', amountUsd: 2.5 }],
      byPullRequest: [{ label: 'Run run_1', amountUsd: 2.5 }],
      byRepository: [{ label: 'lost-gradient/tribunal', amountUsd: 2.5 }],
      byAgent: [{ label: 'security', amountUsd: 2.5 }],
      byAgentPerRepository: [{ label: 'security @ lost-gradient/tribunal', amountUsd: 2.5 }],
      byUserPerDay: [{ label: '1 @ 2026-06-18', amountUsd: 2.5 }],
    },
    cacheTokens: {
      cacheCreationTokens: 10,
      cacheReadTokens: 25,
    },
  },
  surfaceStates: ['empty', 'loading', 'streaming', 'success', 'error', 'disconnected'],
  reviewsEnabled: false,
} satisfies PageData;

describe('/costs page', () => {
  afterEach(() => cleanup());

  it('renders linked source navigation, cap meter, product rollups, and cache split', async () => {
    render(CostsPage, { data, params: {}, form: null });

    const sourceNavigation = page.getByRole('navigation', { name: 'Cost source' });
    const estimateLink = sourceNavigation.getByRole('link', { name: 'Estimate' });
    const reconciledLink = sourceNavigation.getByRole('link', { name: 'Reconciled' });

    await expect.element(estimateLink).toHaveAttribute('href', '/costs?source=estimate');
    await expect.element(estimateLink).toHaveAttribute('aria-current', 'page');
    await expect.element(reconciledLink).toHaveAttribute('href', '/costs?source=reconciled');
    await expect.element(reconciledLink).not.toHaveAttribute('aria-current');
    await expect.element(page.getByText('$2.50 of $10.00')).toBeInTheDocument();
    await expect.element(page.getByText('Repository')).toBeInTheDocument();
    await expect.element(page.getByText('Agent')).toBeInTheDocument();
    await expect.element(page.getByText('Pull request')).toBeInTheDocument();
    await expect.element(page.getByText('By Agent per Repository')).not.toBeInTheDocument();
    await expect.element(page.getByText('Read tokens: 25')).toBeInTheDocument();
  });
});
