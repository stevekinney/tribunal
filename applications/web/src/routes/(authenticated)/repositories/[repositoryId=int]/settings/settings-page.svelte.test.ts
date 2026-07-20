import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import SettingsPage from './+page.svelte';
import type { PageData } from './$types';

const enhancedFormTesting = vi.hoisted(() => ({
  submissions: [] as Array<{ formData: FormData }>,
  onSubmitted: undefined as ((input: unknown) => Promise<void>) | undefined,
  reset() {
    this.submissions.length = 0;
    this.onSubmitted = undefined;
  },
}));

vi.mock('$app/forms', () => ({
  enhance: (
    formElement: HTMLFormElement,
    submitFunction?: (input: {
      action: URL;
      cancel: () => void;
      formData: FormData;
      formElement: HTMLFormElement;
      submitter: SubmitEvent['submitter'];
    }) => void | ((input: unknown) => Promise<void>),
  ) => {
    const handleSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      const formData = new FormData(formElement);
      enhancedFormTesting.submissions.push({ formData });
      const onSubmitted = submitFunction?.({
        action: new URL(formElement.getAttribute('action') ?? '.', 'http://localhost/settings'),
        cancel: () => {},
        formData,
        formElement,
        submitter: event.submitter,
      });
      enhancedFormTesting.onSubmitted = typeof onSubmitted === 'function' ? onSubmitted : undefined;
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
  reviewsEnabled: true,
  repository: {
    id: 101,
    owner: 'test-org',
    name: 'review-target',
    review: {
      hasSavedSettings: true,
      watched: true,
      ignoreGlobs: ['dist/**', 'coverage/**'],
      agents: [{ id: 'agent_1', slug: 'security', enabled: true }],
      lastRunStatus: null,
      estimatedCostLast30DaysUsd: 0,
    },
  },
  agents: [
    {
      id: 'agent_1',
      userId: 1,
      slug: 'security',
      description: '',
      body: '',
      model: 'sonnet',
      effort: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'agent_2',
      userId: 1,
      slug: 'documentation',
      description: '',
      body: '',
      model: 'sonnet',
      effort: null,
      enabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'agent_3',
      userId: 1,
      slug: 'style',
      description: '',
      body: '',
      model: 'sonnet',
      effort: null,
      enabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'agent_4',
      userId: 1,
      slug: 'performance',
      description: '',
      body: '',
      model: 'sonnet',
      effort: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
} satisfies PageData;

describe('/repositories/[repositoryId]/settings page', () => {
  beforeEach(() => {
    enhancedFormTesting.reset();
  });

  afterEach(() => cleanup());

  it('renders breadcrumbs and title with the repository name', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    await expect.element(page.getByRole('heading', { name: 'Repository settings' })).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'test-org/review-target' }))
      .toHaveAttribute('href', '/repositories/101/pull-requests');
  });

  it('initializes committed ignore glob tags from saved settings', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    await expect.element(page.getByText('dist/**')).toBeVisible();
    await expect.element(page.getByText('coverage/**')).toBeVisible();
  });

  it('links each agent row to its detail page by slug', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    await expect
      .element(page.getByRole('link', { name: 'security' }))
      .toHaveAttribute('href', '/agents/agent_1');
    await expect
      .element(page.getByRole('link', { name: 'documentation' }))
      .toHaveAttribute('href', '/agents/agent_2');
  });

  it('renders enabled assigned agents as a checked checkbox', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    const checkbox = page.getByRole('checkbox', { name: 'Assign security to repository' });
    await expect.element(checkbox).toBeChecked();
    await expect.element(checkbox).not.toBeDisabled();
  });

  it('keeps disabled assigned agents visible and removable', async () => {
    render(SettingsPage, {
      data: {
        ...baseData,
        repository: {
          ...baseData.repository,
          review: {
            ...baseData.repository.review,
            agents: [{ id: 'agent_2', slug: 'documentation', enabled: false }],
          },
        },
      },
      form: null,
      params: { repositoryId: '101' },
    });

    const checkbox = page.getByRole('checkbox', { name: 'Assign documentation to repository' });
    await expect.element(checkbox).toBeChecked();
    await expect.element(checkbox).not.toBeDisabled();
    await expect
      .element(page.getByText('Disabled; turn off to remove it from this repository.'))
      .toBeVisible();
  });

  it('renders enabled unassigned agents as an unchecked checkbox', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    const checkbox = page.getByRole('checkbox', { name: 'Assign performance to repository' });
    await expect.element(checkbox).not.toBeChecked();
    await expect.element(checkbox).not.toBeDisabled();
  });

  it('toggling an enabled unassigned agent on adds its id to the submitted agentIds', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    await page.getByRole('checkbox', { name: 'Assign performance to repository' }).click();
    await page.getByRole('button', { name: 'Save settings' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('agentIds')).toEqual([
      'agent_1',
      'agent_4',
    ]);
  });

  it('toggling an enabled assigned agent off removes its id from the submitted agentIds', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    await page.getByRole('checkbox', { name: 'Assign security to repository' }).click();
    await page.getByRole('button', { name: 'Save settings' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('agentIds')).toEqual([]);
  });

  it('disables the checkbox for a disabled unassigned agent with helper text', async () => {
    render(SettingsPage, {
      data: {
        ...baseData,
        agents: [baseData.agents[0]!, baseData.agents[2]!],
      },
      form: null,
      params: { repositoryId: '101' },
    });

    const checkbox = page.getByRole('checkbox', { name: 'Assign style to repository' });
    await expect.element(checkbox).toBeDisabled();
    await expect
      .element(page.getByText('Disabled agents cannot be assigned until re-enabled.'))
      .toBeVisible();
  });

  it('submits one agentIds value per selected agent', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    await page.getByRole('button', { name: 'Save settings' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('agentIds')).toEqual(['agent_1']);
  });

  it('submits one ignoreGlobs value per committed tag', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    await page.getByRole('button', { name: 'Save settings' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('ignoreGlobs')).toEqual([
      'dist/**',
      'coverage/**',
    ]);
  });

  it('includes an uncommitted ignore-glob draft on save without requiring Enter first', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    await page.getByRole('textbox', { name: 'Ignore globs' }).fill('node_modules/**');
    await page.getByRole('button', { name: 'Save settings' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('ignoreGlobs')).toEqual([
      'dist/**',
      'coverage/**',
      'node_modules/**',
    ]);
  });

  it('shows a success alert after a successful save', async () => {
    render(SettingsPage, {
      data: baseData,
      form: { success: true },
      params: { repositoryId: '101' },
    });

    await expect.element(page.getByText('Repository settings saved.')).toBeVisible();
  });

  it('shows an error alert after a failed save', async () => {
    render(SettingsPage, {
      data: baseData,
      form: { error: 'One or more selected agents are unavailable.' },
      params: { repositoryId: '101' },
    });

    await expect
      .element(page.getByText('One or more selected agents are unavailable.'))
      .toBeVisible();
  });

  it('does not call update() when the enhanced result is an error, to avoid navigating to +error.svelte', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    await page.getByRole('button', { name: 'Save settings' }).click();
    const mockUpdate = vi.fn();
    await enhancedFormTesting.onSubmitted?.({
      result: { type: 'error', status: 500, error: new Error('boom') },
      update: mockUpdate,
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('disables agent checkboxes while a save is in flight so pending edits cannot race the request', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    const checkbox = page.getByRole('checkbox', { name: 'Assign security to repository' });
    await expect.element(checkbox).not.toBeDisabled();

    await page.getByRole('button', { name: 'Save settings' }).click();

    await expect.element(checkbox).toBeDisabled();

    await enhancedFormTesting.onSubmitted?.({
      result: { type: 'success', status: 200, data: { success: true } },
      update: vi.fn(),
    });

    await expect.element(checkbox).not.toBeDisabled();
  });

  it('disables the ignore-globs tag input while a save is in flight so pending edits cannot race the request', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    const textbox = page.getByRole('textbox', { name: 'Ignore globs' });
    await expect.element(textbox).not.toBeDisabled();

    await page.getByRole('button', { name: 'Save settings' }).click();

    await expect.element(textbox).toBeDisabled();

    await enhancedFormTesting.onSubmitted?.({
      result: { type: 'success', status: 200, data: { success: true } },
      update: vi.fn(),
    });

    await expect.element(textbox).not.toBeDisabled();
  });

  it('calls update({ reset: false }) when the enhanced result succeeds', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    await page.getByRole('button', { name: 'Save settings' }).click();
    const mockUpdate = vi.fn();
    await enhancedFormTesting.onSubmitted?.({
      result: { type: 'success', status: 200, data: { success: true } },
      update: mockUpdate,
    });

    expect(mockUpdate).toHaveBeenCalledWith({ reset: false });
  });

  it('defaults a first-time (unwatched, unconfigured) repository to all enabled agents on save', async () => {
    // Regression for: saving settings on a never-configured repository used to
    // submit an empty `agentIds` list (only the repository's saved agents,
    // which are empty for first-time repos), silently adding the repository
    // with no reviewers instead of the all-enabled-agent default used by the
    // dashboard's Add/toggle flow.
    render(SettingsPage, {
      data: {
        ...baseData,
        repository: {
          ...baseData.repository,
          review: {
            ...baseData.repository.review,
            hasSavedSettings: false,
            watched: false,
            agents: [],
          },
        },
      },
      form: null,
      params: { repositoryId: '101' },
    });

    await page.getByRole('button', { name: 'Save settings' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('agentIds')).toEqual([
      'agent_1',
      'agent_4',
    ]);
  });

  it('does not default a disabled agent onto a first-time repository', async () => {
    render(SettingsPage, {
      data: {
        ...baseData,
        repository: {
          ...baseData.repository,
          review: {
            ...baseData.repository.review,
            hasSavedSettings: false,
            watched: false,
            agents: [],
          },
        },
        agents: baseData.agents.filter((agent) => agent.id === 'agent_1' || agent.id === 'agent_2'),
      },
      form: null,
      params: { repositoryId: '101' },
    });

    await page.getByRole('button', { name: 'Save settings' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('agentIds')).toEqual(['agent_1']);
  });

  it('preserves the saved agent assignment for an already-configured repository', async () => {
    render(SettingsPage, { data: baseData, form: null, params: { repositoryId: '101' } });

    await page.getByRole('button', { name: 'Save settings' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('agentIds')).toEqual(['agent_1']);
  });
});
