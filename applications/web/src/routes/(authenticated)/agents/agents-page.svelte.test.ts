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

  it('allows xhigh effort storage for models that fall back at runtime', async () => {
    render(AgentsPage, { data, form: null });

    await expect.element(page.getByRole('option', { name: 'xhigh' })).not.toBeDisabled();
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
          costEstimateUsd: 0.0042,
        },
        values: {
          id: '',
          slug: '',
          description: '',
          body: 'Review the changed authentication code.',
          sampleDiff: 'diff --git a/src/auth.ts b/src/auth.ts\n+allowAllUsers();',
          model: 'sonnet',
          effort: 'high',
          enabled: true,
        },
      },
    });

    await expect.element(page.getByLabelText('Sample diff')).toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: 'Dry run estimate' }))
      .toBeInTheDocument();
    await expect.element(page.getByText('$0.0042')).toBeInTheDocument();
    await expect.element(page.getByText('128 input tokens')).toBeInTheDocument();
    await expect.element(page.getByText('64 output tokens')).toBeInTheDocument();
    await expect
      .element(page.getByLabelText('System prompt'))
      .toHaveValue('Review the changed authentication code.');
  });

  it('keeps dry-run submission outside save-only slug and description validation', async () => {
    render(AgentsPage, { data, form: null });

    const dryRunButton = page.getByRole('button', { name: 'Dry run estimate' });

    await expect.element(dryRunButton).toHaveAttribute('type', 'submit');
    await expect.element(dryRunButton).not.toHaveAttribute('formaction');
  });

  it('hides stale dry-run estimates after model or effort changes', async () => {
    render(AgentsPage, {
      data,
      form: {
        dryRunEstimate: {
          model: 'sonnet',
          effort: 'high',
          estimatedInputTokens: 128,
          estimatedOutputTokens: 64,
          costEstimateUsd: 0.0042,
        },
        values: {
          id: '',
          slug: '',
          description: '',
          body: 'Review the changed authentication code.',
          sampleDiff: 'diff --git a/src/auth.ts b/src/auth.ts\n+allowAllUsers();',
          model: 'sonnet',
          effort: 'high',
          enabled: true,
        },
      },
    });

    await expect.element(page.getByText('$0.0042')).toBeInTheDocument();
    await page.getByLabelText('Effort').selectOptions('low');
    await expect.element(page.getByText('$0.0042')).not.toBeInTheDocument();
  });

  it('resets sample diff when switching edited agents', async () => {
    render(AgentsPage, {
      data: {
        ...data,
        agents: [
          {
            id: 'agent_security',
            userId: 1,
            slug: 'security',
            description: 'Finds security issues',
            body: 'Review security changes.',
            model: 'sonnet',
            effort: null,
            enabled: true,
            createdAt: new Date('2026-06-18T12:00:00Z'),
            updatedAt: new Date('2026-06-18T12:00:00Z'),
          },
        ],
      },
      form: {
        dryRunEstimate: {
          model: 'sonnet',
          effort: null,
          estimatedInputTokens: 128,
          estimatedOutputTokens: 64,
          costEstimateUsd: 0.0042,
        },
        values: {
          id: '',
          slug: '',
          description: '',
          body: 'Review the changed authentication code.',
          sampleDiff: 'diff --git a/src/auth.ts b/src/auth.ts\n+allowAllUsers();',
          model: 'sonnet',
          effort: '',
          enabled: true,
        },
      },
    });

    await expect
      .element(page.getByLabelText('Sample diff'))
      .toHaveValue('diff --git a/src/auth.ts b/src/auth.ts\n+allowAllUsers();');
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect.element(page.getByLabelText('Sample diff')).toHaveValue('');
  });
});
