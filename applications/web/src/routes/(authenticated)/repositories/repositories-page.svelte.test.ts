import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RepositoriesPage from './+page.svelte';
import type { PageData } from './$types';

const enhancedFormTesting = vi.hoisted(() => {
  function createDeferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise;
    });
    return { promise, resolve };
  }

  return {
    submissions: [] as Array<{ formData: FormData; resolveUpdate: () => void }>,
    createDeferred,
    reset() {
      this.submissions.length = 0;
    },
  };
});

vi.mock('$app/forms', () => ({
  enhance: (
    formElement: HTMLFormElement,
    submitFunction?: (input: {
      action: URL;
      cancel: () => void;
      formData: FormData;
      formElement: HTMLFormElement;
      submitter: SubmitEvent['submitter'];
    }) =>
      | void
      | ((input: {
          action: URL;
          formData: FormData;
          formElement: HTMLFormElement;
          result: { type: 'success'; status: 200; data: Record<string, never> };
          update: () => Promise<void>;
        }) => Promise<void>),
  ) => {
    const handleSubmit = async (event: SubmitEvent) => {
      event.preventDefault();

      const formData = new FormData(formElement);
      const action = new URL(
        formElement.getAttribute('action') ?? '.',
        'http://localhost/repositories',
      );
      const resultHandler = submitFunction?.({
        action,
        cancel: () => {},
        formData,
        formElement,
        submitter: event.submitter,
      });
      const deferredUpdate = enhancedFormTesting.createDeferred();
      enhancedFormTesting.submissions.push({
        formData,
        resolveUpdate: deferredUpdate.resolve,
      });

      if (typeof resultHandler === 'function') {
        await resultHandler({
          action,
          formData,
          formElement,
          result: { type: 'success', status: 200, data: {} },
          update: () => deferredUpdate.promise,
        });
      }
    };

    formElement.addEventListener('submit', handleSubmit);
    return {
      destroy() {
        formElement.removeEventListener('submit', handleSubmit);
      },
    };
  },
}));

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
  beforeEach(() => {
    enhancedFormTesting.reset();
  });

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

  it('queues rapid watch re-toggles so the final submitted state wins', async () => {
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
              hasSavedSettings: false,
              watched: false,
              lastRunStatus: null,
              estimatedCostLast30DaysUsd: 0,
              ignoreGlobs: [],
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

    const watchSwitch = page.getByRole('switch', { name: 'Watch repository' });

    await watchSwitch.click();
    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.get('watched')).toBe('on');

    await page.getByRole('switch', { name: 'Unwatch repository' }).click();
    expect(enhancedFormTesting.submissions).toHaveLength(1);

    enhancedFormTesting.submissions[0]?.resolveUpdate();

    await expect.poll(() => enhancedFormTesting.submissions.length).toBe(2);
    expect(enhancedFormTesting.submissions[1]?.formData.get('watched')).toBe('');
  });
});
