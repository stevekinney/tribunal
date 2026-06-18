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

  it('shows the xhigh fallback notice for sonnet', async () => {
    render(AgentsPage, { data, form: null });

    await expect
      .element(
        page.getByText(
          'xhigh will be stored, but this model falls back to high effort at runtime.',
        ),
      )
      .toBeInTheDocument();
  });
});
