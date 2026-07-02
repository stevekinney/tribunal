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

const baseAgent = {
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
};

const data = {
  user,
  reviewsEnabled: true,
  agents: [],
} satisfies PageData;

describe('/agents page', () => {
  afterEach(() => cleanup());

  it('links to the dedicated new-agent route from the header', async () => {
    render(AgentsPage, { data, form: null, params: {} });

    await expect
      .element(page.getByRole('banner').getByRole('link', { name: 'New agent' }))
      .toHaveAttribute('href', '/agents/new');
    await expect.element(page.getByRole('heading', { name: 'No agents' })).toBeVisible();
    await expect
      .element(page.getByText('Create a review agent to start checking watched repositories.'))
      .toBeVisible();
  });

  it('renders agents as rows with edit, toggle, and delete actions', async () => {
    render(AgentsPage, {
      data: {
        ...data,
        agents: [baseAgent],
      },
      form: null,
      params: {},
    });

    await expect.element(page.getByRole('heading', { name: 'security' })).toBeVisible();
    await expect.element(page.getByText('Finds security issues')).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Edit' }))
      .toHaveAttribute('href', '/agents/agent_security');
    await expect
      .element(page.getByRole('switch', { name: 'Disable security' }))
      .toHaveAttribute('aria-checked', 'true');
    await expect.element(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect.element(page.getByText('Review security changes.')).not.toBeInTheDocument();
  });
});
