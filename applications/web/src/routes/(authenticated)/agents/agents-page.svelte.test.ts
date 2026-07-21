import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('links the agent slug to the detail route as the primary navigation', async () => {
    render(AgentsPage, {
      data: {
        ...data,
        agents: [baseAgent],
      },
      form: null,
      params: {},
    });

    await expect
      .element(page.getByRole('link', { name: 'security' }))
      .toHaveAttribute('href', '/agents/agent_security');
    await expect.element(page.getByText('Finds security issues')).toBeVisible();
  });

  it('does not render a delete button or a redundant edit link', async () => {
    render(AgentsPage, {
      data: {
        ...data,
        agents: [baseAgent],
      },
      form: null,
      params: {},
    });

    await expect.element(page.getByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('shows one visible status label and an accessible toggle', async () => {
    render(AgentsPage, {
      data: {
        ...data,
        agents: [baseAgent],
      },
      form: null,
      params: {},
    });

    await expect.element(page.getByText('Enabled', { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole('switch', { name: 'Agent security enabled' }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('omits the description line when a row has no description', async () => {
    render(AgentsPage, {
      data: {
        ...data,
        agents: [{ ...baseAgent, description: '' }],
      },
      form: null,
      params: {},
    });

    await expect.element(page.getByRole('link', { name: 'security' })).toBeVisible();
    await expect.element(page.getByText('Finds security issues')).not.toBeInTheDocument();
  });

  it('shows an effort badge when the agent has a configured effort level', async () => {
    render(AgentsPage, {
      data: {
        ...data,
        agents: [{ ...baseAgent, effort: 'xhigh' }],
      },
      form: null,
      params: {},
    });

    await expect.element(page.getByText('xhigh')).toBeVisible();
  });

  it('surfaces a batch action error from the form', async () => {
    render(AgentsPage, {
      data: { ...data, agents: [baseAgent] },
      form: { error: 'Could not update the agent.' },
      params: {},
    });

    await expect.element(page.getByText('Could not update the agent.')).toBeVisible();
  });

  it('submits the enabled-toggle form when the toggle is flipped', async () => {
    render(AgentsPage, {
      data: { ...data, agents: [baseAgent] },
      form: null,
      params: {},
    });

    const form = document.getElementById('agent-agent_security-enabled-form') as HTMLFormElement;
    const submitSpy = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {});

    await page.getByRole('switch', { name: 'Agent security enabled' }).click();

    expect(submitSpy).toHaveBeenCalledTimes(1);
  });
});
