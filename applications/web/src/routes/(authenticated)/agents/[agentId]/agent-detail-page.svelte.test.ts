import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import AgentDetailPage from './+page.svelte';
import type { PageData } from './$types';

const data = {
  user: {
    id: 1,
    username: 'testuser',
    name: 'Test User',
    avatarUrl: null,
    email: 'test@example.com',
    isPlatformAdministrator: false,
  },
  reviewsEnabled: true,
  agent: {
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
  defaultModel: 'sonnet',
  modelOptions: ['inherit', 'sonnet', 'opus', 'haiku', 'fable'],
  effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
} satisfies PageData;

describe('/agents/[agentId] page', () => {
  afterEach(() => cleanup());

  it('does not render a separate prompt preview card above the editor', async () => {
    render(AgentDetailPage, { data, form: null, params: { agentId: data.agent.id } });

    await expect
      .element(page.getByRole('heading', { name: 'Prompt preview' }))
      .not.toBeInTheDocument();
  });

  it('renders identity before the prompt editor and a danger zone with delete', async () => {
    render(AgentDetailPage, { data, form: null, params: { agentId: data.agent.id } });

    const headings = await page.getByRole('heading', { level: 2 }).all();
    const headingTexts = await Promise.all(
      headings.map((heading) => heading.element().textContent),
    );

    expect(headingTexts.indexOf('Agent basics')).toBeLessThan(headingTexts.indexOf('Prompt'));
    expect(headingTexts).toContain('Danger zone');
    await expect.element(page.getByRole('button', { name: 'Delete agent' })).toBeVisible();
  });

  it('gates deletion behind a confirmation dialog', async () => {
    render(AgentDetailPage, { data, form: null, params: { agentId: data.agent.id } });

    await page.getByRole('button', { name: 'Delete agent' }).click();

    const dialog = page.getByRole('dialog');
    await expect.element(dialog.getByRole('heading', { name: 'Delete security?' })).toBeVisible();
    await expect.element(dialog.getByRole('button', { name: 'Delete agent' })).toBeVisible();
  });
});
