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
    const dailySpendMeter = page.getByRole('meter', { name: "Today's spend vs daily cap" });
    await expect.element(dailySpendMeter).toHaveAttribute('aria-valuemin', '0');
    await expect.element(dailySpendMeter).toHaveAttribute('aria-valuemax', '10');
    await expect.element(dailySpendMeter).toHaveAttribute('aria-valuenow', '2.5');
    await expect
      .element(dailySpendMeter)
      .toHaveAttribute('aria-valuetext', '$2.50 of $10.00 daily cap');
    await expect.element(page.getByText('$2.50 of $10.00')).toBeInTheDocument();
    await expect.element(page.getByText('Repository')).toBeInTheDocument();
    await expect.element(page.getByText('Agent')).toBeInTheDocument();
    await expect.element(page.getByText('Pull request')).toBeInTheDocument();
    await expect.element(page.getByText('By Agent per Repository')).not.toBeInTheDocument();
    await expect.element(page.getByText('Read tokens: 25')).toBeInTheDocument();
  });

  it('renders a zero daily cap as reached without exposing an invalid meter range', async () => {
    render(CostsPage, {
      data: {
        ...data,
        costs: { ...data.costs, dailyCostCapUsd: 0 },
      },
      params: {},
      form: null,
    });

    await expect.element(page.getByText('Daily cap reached')).toBeInTheDocument();
    await expect.element(page.getByText('$2.50 of $0.00')).toBeInTheDocument();
    await expect
      .element(page.getByRole('meter', { name: "Today's spend vs daily cap" }))
      .not.toBeInTheDocument();
  });

  it('clamps an over-cap meter while preserving the actual spend in its accessible value', async () => {
    render(CostsPage, {
      data: {
        ...data,
        costs: { ...data.costs, todayTotalUsd: 12.5 },
      },
      params: {},
      form: null,
    });

    const dailySpendMeter = page.getByRole('meter', { name: "Today's spend vs daily cap" });
    await expect.element(dailySpendMeter).toHaveAttribute('aria-valuenow', '10');
    await expect
      .element(dailySpendMeter)
      .toHaveAttribute('aria-valuetext', '$12.50 of $10.00 daily cap');
  });

  it('switches the breakdown to another dimension when its segment is selected', async () => {
    render(CostsPage, { data, params: {}, form: null });

    await expect.element(page.getByText('security', { exact: true })).toBeInTheDocument();

    await page.getByRole('radio', { name: 'Repository' }).click();

    await expect.element(page.getByText('lost-gradient/tribunal')).toBeInTheDocument();
    await expect.element(page.getByText('security', { exact: true })).not.toBeInTheDocument();
  });

  it('exposes accessible breakdown meters that update when the dimension changes', async () => {
    render(CostsPage, {
      data: {
        ...data,
        costs: {
          ...data.costs,
          rollups: {
            ...data.costs.rollups,
            byAgent: [
              { label: 'security', amountUsd: 2.5 },
              { label: 'accessibility', amountUsd: 0 },
            ],
            byRepository: [
              { label: 'lost-gradient/tribunal', amountUsd: 1.75 },
              { label: 'lost-gradient/cinder', amountUsd: 0.75 },
            ],
          },
        },
      },
      params: {},
      form: null,
    });

    const agentMeter = page.getByRole('meter', { name: 'security, $2.50' });
    await expect.element(agentMeter).toHaveAttribute('aria-valuemin', '0');
    await expect.element(agentMeter).toHaveAttribute('aria-valuemax', '2.5');
    await expect.element(agentMeter).toHaveAttribute('aria-valuenow', '2.5');
    await expect.element(agentMeter).toHaveAttribute('aria-valuetext', '$2.50');

    const zeroValueMeter = page.getByRole('meter', { name: 'accessibility, $0.00' });
    await expect.element(zeroValueMeter).toHaveAttribute('aria-valuenow', '0');

    await page.getByRole('radio', { name: 'Repository' }).click();

    const repositoryMeter = page.getByRole('meter', {
      name: 'lost-gradient/tribunal, $1.75',
    });
    await expect.element(repositoryMeter).toHaveAttribute('aria-valuemax', '1.75');
    await expect.element(repositoryMeter).toHaveAttribute('aria-valuenow', '1.75');
    await expect
      .element(page.getByRole('meter', { name: 'security, $2.50' }))
      .not.toBeInTheDocument();
  });

  it('shows an empty note when the active dimension has no cost rows', async () => {
    render(CostsPage, {
      data: { ...data, costs: { ...data.costs, rollups: { ...data.costs.rollups, byAgent: [] } } },
      params: {},
      form: null,
    });

    await expect.element(page.getByText('No cost events for this dimension.')).toBeInTheDocument();
  });
});
