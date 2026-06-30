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
  agents: [],
  installations: [],
  needsConnect: false,
  loadError: null,
  surfaceStates: ['empty', 'loading', 'streaming', 'success', 'error', 'disconnected'],
  reviewsEnabled: false,
} satisfies PageData;

describe('/repositories page', () => {
  it('prompts users to install the GitHub App when no installation exists', async () => {
    render(RepositoriesPage, { data: baseData, form: null, params: {} });

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
      params: {},
    });

    await expect.element(page.getByText('No repositories selected')).toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'Manage repository access' }))
      .toHaveAttribute('href', '/connect/github');
  });

  it('preserves saved repository settings when re-watching a repository', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        agents: [
          {
            id: '1',
            userId: 1,
            slug: 'security',
            description: 'Security reviews',
            body: 'Review security risks.',
            model: 'gpt-5',
            effort: null,
            enabled: true,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
          },
          {
            id: '2',
            userId: 1,
            slug: 'documentation',
            description: 'Documentation reviews',
            body: 'Review documentation.',
            model: 'gpt-5',
            effort: null,
            enabled: true,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
          },
        ],
        repositories: [
          {
            id: 101,
            owner: 'test-org',
            name: 'review-target',
            defaultBranch: 'main',
            accountLogin: 'test-org',
            accountAvatarUrl: null,
            review: {
              hasSavedSettings: true,
              watched: false,
              lastRunStatus: null,
              estimatedCostLast30DaysUsd: 0,
              ignoreGlobs: ['generated/**', 'vendor/**'],
              agents: [
                {
                  id: '2',
                  slug: 'documentation',
                  enabled: true,
                },
              ],
            },
          },
        ],
        installations: [
          {
            installationId: 12345,
            accountLogin: 'test-org',
            accountAvatarUrl: null,
          },
        ],
      },
      form: null,
      params: {},
    });

    await page.getByRole('searchbox').fill('review-target');

    // exact:true disambiguates the owner span from the icon button's sr-only
    // "Settings for test-org/…" label (Playwright getByText defaults to substring).
    await expect.element(page.getByText('test-org', { exact: true })).toBeInTheDocument();

    const agentsSelect = page.getByLabelText('Agents').element() as HTMLSelectElement;
    expect(Array.from(agentsSelect.selectedOptions).map((option) => option.value)).toEqual(['2']);
    await expect
      .element(page.getByLabelText('Ignore globs'))
      .toHaveValue('generated/**\nvendor/**');
  });

  it('preserves empty saved agent assignments when re-watching a repository', async () => {
    render(RepositoriesPage, {
      data: {
        ...baseData,
        agents: [
          {
            id: '1',
            userId: 1,
            slug: 'security',
            description: 'Security reviews',
            body: 'Review security risks.',
            model: 'gpt-5',
            effort: null,
            enabled: true,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
          },
        ],
        repositories: [
          {
            id: 101,
            owner: 'test-org',
            name: 'review-target',
            defaultBranch: 'main',
            accountLogin: 'test-org',
            accountAvatarUrl: null,
            review: {
              hasSavedSettings: true,
              watched: false,
              lastRunStatus: null,
              estimatedCostLast30DaysUsd: 0,
              ignoreGlobs: ['generated/**'],
              agents: [],
            },
          },
        ],
        installations: [
          {
            installationId: 12345,
            accountLogin: 'test-org',
            accountAvatarUrl: null,
          },
        ],
      },
      form: null,
      params: {},
    });

    await page.getByRole('searchbox').fill('review-target');
    // exact:true disambiguates the owner span from the icon button's sr-only
    // "Settings for test-org/…" label (Playwright getByText defaults to substring).
    await expect.element(page.getByText('test-org', { exact: true })).toBeInTheDocument();

    const agentsSelect = page.getByLabelText('Agents').element() as HTMLSelectElement;
    expect(Array.from(agentsSelect.selectedOptions)).toHaveLength(0);
  });
});
