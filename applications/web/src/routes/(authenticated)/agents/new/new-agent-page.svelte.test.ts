import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import NewAgentPage from './+page.svelte';
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
  defaultModel: 'sonnet',
  modelOptions: ['inherit', 'sonnet', 'opus', 'haiku', 'fable'],
  effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
} satisfies PageData;

describe('/agents/new page', () => {
  afterEach(() => cleanup());

  it('renders the shared agent editor for the create flow', async () => {
    render(NewAgentPage, { data, form: null, params: {} });

    await expect.element(page.getByRole('heading', { name: 'New agent' })).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Identity' })).toBeVisible();
    await expect.element(page.getByLabelText('Slug')).toHaveValue('');
    await expect.element(page.getByRole('button', { name: 'Create agent' })).toBeVisible();
  });

  it('defaults a new agent to enabled in the header checkbox and the submitted form', async () => {
    render(NewAgentPage, { data, form: null, params: {} });

    await expect
      .element(page.getByRole('banner').getByRole('checkbox', { name: 'Enabled' }))
      .toBeChecked();

    const saveForm = document.querySelector<HTMLFormElement>('form[action="?/save"]')!;
    expect(new FormData(saveForm).get('enabled')).toBe('on');
  });
});
