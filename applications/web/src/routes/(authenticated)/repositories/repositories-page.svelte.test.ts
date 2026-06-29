import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RepositoriesPage from './+page.svelte';
import type { PageData } from './$types';

const baseData = {
  user: {
    id: 1,
    username: 'testuser',
    name: 'Test User',
    avatarUrl: null,
    email: 'test@example.com',
    isPlatformAdministrator: false,
  },
  repositories: [],
  installations: [],
  needsConnect: false,
  loadError: null,
  surfaceStates: ['empty', 'loading', 'streaming', 'success', 'error', 'disconnected'],
} satisfies PageData;

describe('/repositories page', () => {
  it('prompts users to install the GitHub App when no installation exists', async () => {
    render(RepositoriesPage, {
      data: baseData,
      form: null,
    } as any);

    await expect
      .element(page.getByRole('heading', { name: 'Install the GitHub App' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'Install GitHub App' }))
      .toHaveAttribute('href', '/connect/github');
  });

  it('prompts users to manage repository access when an installation already exists', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        installations: [
          {
            installationId: 12345,
            accountLogin: 'test-org',
            accountAvatarUrl: null,
          },
        ],
      },
      form: null,
    } as any);

    await expect.element(page.getByText('No repositories selected')).toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'Manage repository access' }))
      .toHaveAttribute('href', '/connect/github');
  });
});
