import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import AgentsPage from './+page.svelte';
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
  agents: [],
  modelOptions: ['inherit', 'sonnet', 'opus', 'haiku', 'fable'],
  effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
  surfaceStates: ['empty', 'loading', 'streaming', 'success', 'error', 'disconnected'],
} satisfies PageData;

describe('/agents page', () => {
  afterEach(() => cleanup());

  it('gates xhigh effort for ineligible models', async () => {
    render(AgentsPage, { data, form: null });

    await expect.element(page.getByRole('option', { name: 'xhigh' })).toBeDisabled();
  });

  it('renders sample diff dry-run controls and estimated cost results', async () => {
    render(AgentsPage, {
      data,
      form: {
        dryRunEstimate: {
          model: 'sonnet',
          effort: 'high',
          estimatedInputTokens: 128,
          estimatedOutputTokens: 64,
          costEstimateUsd: 0.42,
        },
      },
    });

    await expect.element(page.getByLabelText('Sample diff')).toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: 'Dry run estimate' }))
      .toBeInTheDocument();
    await expect.element(page.getByText('$0.42')).toBeInTheDocument();
    await expect.element(page.getByText('128 input tokens')).toBeInTheDocument();
    await expect.element(page.getByText('64 output tokens')).toBeInTheDocument();
  });
});
