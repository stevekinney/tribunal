import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('renders identity before the prompt editor and a collapsed danger zone', async () => {
    render(AgentDetailPage, { data, form: null, params: { agentId: data.agent.id } });

    const headings = page.getByRole('heading', { level: 2 }).all();
    const headingTexts = await Promise.all(
      headings.map((heading) => heading.element().textContent),
    );

    expect(headingTexts).toContain('Identity');
    expect(headingTexts.indexOf('Identity')).toBeLessThan(headingTexts.indexOf('Runtime'));
    expect(headingTexts).not.toContain('Danger zone');

    await expect
      .element(page.getByRole('button', { name: 'Danger zone' }))
      .toHaveAttribute('aria-expanded', 'false');
    await expect
      .element(page.getByRole('button', { name: 'Delete agent' }))
      .not.toBeInTheDocument();
  });

  it('reveals the delete action once the danger zone is expanded', async () => {
    render(AgentDetailPage, { data, form: null, params: { agentId: data.agent.id } });

    await page.getByRole('button', { name: 'Danger zone' }).click();

    await expect.element(page.getByRole('button', { name: 'Delete agent' })).toBeVisible();
  });

  it('moves the Enabled control into the page header as a deferred checkbox, bound to the enabled form field', async () => {
    render(AgentDetailPage, { data, form: null, params: { agentId: data.agent.id } });

    const banner = page.getByRole('banner');
    await expect.element(banner.getByRole('checkbox', { name: 'Enabled' })).toBeChecked();

    const saveForm = document.querySelector<HTMLFormElement>('form[action="?/save"]')!;
    expect(new FormData(saveForm).get('enabled')).toBe('on');

    await banner.getByRole('checkbox', { name: 'Enabled' }).click();
    expect(new FormData(saveForm).get('enabled')).toBeNull();
  });

  it('gates deletion behind a confirmation dialog', async () => {
    render(AgentDetailPage, { data, form: null, params: { agentId: data.agent.id } });

    await page.getByRole('button', { name: 'Danger zone' }).click();
    await expect.element(page.getByRole('button', { name: 'Delete agent' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete agent' }).click();

    const dialog = page.getByRole('dialog');
    await expect.element(dialog.getByRole('heading', { name: 'Delete security?' })).toBeVisible();
    await expect.element(dialog.getByRole('button', { name: 'Delete agent' })).toBeVisible();
  });

  it('submits the delete form when the confirmation dialog is confirmed', async () => {
    render(AgentDetailPage, { data, form: null, params: { agentId: data.agent.id } });

    // The delete form only mounts once the collapsed danger zone is expanded.
    await page.getByRole('button', { name: 'Danger zone' }).click();
    await expect.element(page.getByRole('button', { name: 'Delete agent' })).toBeVisible();

    const deleteForm = document.querySelector<HTMLFormElement>('form[action="?/delete"]')!;
    const submitSpy = vi.spyOn(deleteForm, 'requestSubmit').mockImplementation(() => {});

    await page.getByRole('button', { name: 'Delete agent' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete agent' }).click();

    expect(submitSpy).toHaveBeenCalledTimes(1);
  });
});
