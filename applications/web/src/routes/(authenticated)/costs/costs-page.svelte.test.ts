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
      bySource: [{ label: 'estimate', amountUsd: 2.5 }],
      byKind: [{ label: 'llm', amountUsd: 2.5 }],
      byRepository: [{ label: 'lost-gradient/tribunal', amountUsd: 2.5 }],
      byPullRequest: [{ label: 'Run run_1', amountUsd: 2.5 }],
      byRun: [{ label: 'run_1', amountUsd: 2.5 }],
      byAgent: [{ label: 'security', amountUsd: 2.5 }],
    },
    cacheTokens: {
      cacheCreationTokens: 10,
      cacheReadTokens: 25,
    },
  },
  surfaceStates: ['empty', 'loading', 'streaming', 'success', 'error', 'disconnected'],
} satisfies PageData;

describe('/costs page', () => {
  afterEach(() => cleanup());

  it('renders source toggle, cap meter, six rollups, and cache split', async () => {
    render(CostsPage, { data });

    await expect
      .element(page.getByRole('link', { name: 'Estimate' }))
      .toHaveAttribute('data-active', 'true');
    await expect.element(page.getByText('$2.50 of $10.00')).toBeInTheDocument();
    await expect.element(page.getByText('byRepository')).toBeInTheDocument();
    await expect.element(page.getByText('Read tokens: 25')).toBeInTheDocument();
  });
});
