import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PullRequestsPage from './+page.svelte';
import type { PageData } from './$types';

const enhancedFormTesting = vi.hoisted(() => ({
  submissions: [] as Array<{ formData: FormData }>,
  reset() {
    this.submissions.length = 0;
  },
}));

vi.mock('$app/forms', () => ({
  enhance: (formElement: HTMLFormElement) => {
    const handleSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      enhancedFormTesting.submissions.push({ formData: new FormData(formElement) });
    };

    formElement.addEventListener('submit', handleSubmit);
    return {
      destroy() {
        formElement.removeEventListener('submit', handleSubmit);
      },
    };
  },
}));

type Agent = PageData['agents'][number];

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
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
    ...overrides,
  };
}

const baseData = {
  user: {
    id: 1,
    username: 'testuser',
    name: 'Test User',
    avatarUrl: null,
    email: 'test@example.com',
    isPlatformAdministrator: false,
  },
  reviewsEnabled: false,
  repository: {
    id: 101,
    owner: 'test-org',
    name: 'review-target',
    review: {
      hasSavedSettings: false,
      watched: false,
      ignoreGlobs: [],
      agents: [],
      lastRunStatus: null,
      estimatedCostLast30DaysUsd: 0,
    },
  },
  agents: [],
  pullRequests: [],
} satisfies PageData;

describe('/repositories/[repositoryId]/pull-requests page', () => {
  beforeEach(() => {
    enhancedFormTesting.reset();
  });

  it('defaults a first-time (unwatched, unconfigured) repository to all enabled agents on save', async () => {
    render(PullRequestsPage, {
      data: {
        ...baseData,
        agents: [makeAgent({ id: '1', slug: 'security' }), makeAgent({ id: '2', slug: 'docs' })],
      },
      form: null,
    });

    // Regression for: saving settings on a never-configured repository used to
    // submit an empty `agentIds` list (only the repository's saved agents,
    // which are empty for first-time repos), silently adding the repository
    // with no reviewers instead of the all-enabled-agent default used by the
    // dashboard's Add/toggle flow.
    await page.getByRole('button', { name: 'Save settings' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('agentIds')).toEqual(['1', '2']);
  });

  it('does not default a disabled agent onto a first-time repository', async () => {
    render(PullRequestsPage, {
      data: {
        ...baseData,
        agents: [
          makeAgent({ id: '1', slug: 'security', enabled: true }),
          makeAgent({ id: '2', slug: 'docs', enabled: false }),
        ],
      },
      form: null,
    });

    await page.getByRole('button', { name: 'Save settings' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('agentIds')).toEqual(['1']);
  });

  it('preserves the saved agent assignment for an already-configured repository', async () => {
    render(PullRequestsPage, {
      data: {
        ...baseData,
        repository: {
          ...baseData.repository,
          review: {
            hasSavedSettings: true,
            watched: true,
            ignoreGlobs: [],
            agents: [{ id: '2', slug: 'docs', enabled: true }],
            lastRunStatus: null,
            estimatedCostLast30DaysUsd: 0,
          },
        },
        agents: [makeAgent({ id: '1', slug: 'security' }), makeAgent({ id: '2', slug: 'docs' })],
      },
      form: null,
    });

    await page.getByRole('button', { name: 'Save settings' }).click();

    expect(enhancedFormTesting.submissions).toHaveLength(1);
    expect(enhancedFormTesting.submissions[0]?.formData.getAll('agentIds')).toEqual(['2']);
  });
});
