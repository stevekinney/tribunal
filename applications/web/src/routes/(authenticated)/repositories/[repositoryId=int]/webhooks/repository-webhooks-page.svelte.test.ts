import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import RepositoryWebhooksPage from './+page.svelte';
import type { PageData } from './$types';
import type { WebhookEventRow } from '$lib/server/webhook-events';

const mocks = vi.hoisted(() => ({
  svelteKitPage: {
    url: new URL('http://localhost/repositories/42/webhooks'),
  },
  goto: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: mocks.svelteKitPage,
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto,
}));

function createEvent(overrides: Partial<WebhookEventRow> = {}): WebhookEventRow {
  return {
    id: 1,
    eventType: 'push',
    action: null,
    deliveryId: 'delivery-1',
    repositoryId: 42,
    repositoryOwner: 'acme',
    repositoryName: 'widgets',
    installationId: 99,
    senderLogin: 'octocat',
    prNumber: null,
    issueNumber: null,
    ref: 'refs/heads/main',
    commitSha: 'abc1234def',
    receivedAt: '2026-01-01T00:00:00.000Z',
    githubCreatedAt: null,
    rawPayload: 'not valid json {{{',
    payload: null,
    payloadParseError: true,
    listenerProgress: {
      receivedOnly: true,
      matchCount: 0,
      matchedListenerNames: [],
      status: 'received_only',
      hasError: false,
      matches: [],
    },
    ...overrides,
  };
}

function createData(overrides: Partial<PageData> = {}): PageData {
  return {
    repository: { id: 42, owner: 'acme', name: 'widgets' },
    events: [createEvent()],
    page: 1,
    perPage: 25,
    totalCount: 1,
    filters: {
      eventType: undefined,
      action: undefined,
      repositoryId: undefined,
      prNumber: undefined,
      issueNumber: undefined,
      senderLogin: undefined,
      ref: undefined,
      deliveryId: undefined,
      page: 1,
      perPage: 25,
    },
    filterOptions: { eventTypes: ['push'], actions: [] },
    ...overrides,
  } as PageData;
}

describe('/repositories/[repositoryId]/webhooks page', () => {
  beforeEach(() => {
    mocks.svelteKitPage.url = new URL('http://localhost/repositories/42/webhooks');
    mocks.goto.mockReset();
  });

  afterEach(() => cleanup());

  it('lists events for the route repository without a repository filter column', async () => {
    render(RepositoryWebhooksPage, { data: createData() });

    await expect.element(page.getByRole('cell', { name: 'push' })).toBeInTheDocument();
    await expect.element(page.getByText('refs/heads/main')).toBeInTheDocument();
    await expect.element(page.getByText('delivery-1', { exact: true })).toBeInTheDocument();
    await expect
      .element(page.getByRole('combobox', { name: 'Repository' }))
      .not.toBeInTheDocument();
  });

  it('shows an empty state when the repository has no webhook events', async () => {
    render(RepositoryWebhooksPage, {
      data: createData({ events: [], totalCount: 0 }),
    });

    await expect.element(page.getByText('No webhook events received')).toBeInTheDocument();
  });

  it('shows a raw-fallback warning for invalid JSON payloads when expanded', async () => {
    render(RepositoryWebhooksPage, { data: createData() });

    await page.getByRole('button', { name: /Show details/ }).click();

    await expect.poll(() => document.getElementById('webhook-event-detail-1')).not.toBeNull();
    const detail = document.getElementById('webhook-event-detail-1');
    const metadataList = detail?.querySelector('.cinder-description-list');
    expect(metadataList).not.toBeNull();
    const detailText = detail?.textContent ?? '';
    expect(detailText).toContain('Event');
    expect(detailText).toContain('push');
    expect(detailText).toContain('Repository');
    expect(detailText).toContain('acme/widgets');
    expect(detailText).toContain('Installation ID');
    expect(detailText).toContain('99');
    expect(detailText).toContain('Sender');
    expect(detailText).toContain('octocat');
    expect(detailText).toContain('Related object');
    expect(detailText).toContain('refs/heads/main · abc1234');
    expect(detailText).toContain('GitHub timestamp');
    expect(detailText).toContain('Unknown');
    expect(detailText).toContain('Received');
    expect(detailText).toContain('Delivery ID');
    expect(detailText).toContain('delivery-1');
    await expect
      .element(page.getByText("This event's stored payload was not valid JSON.", { exact: false }))
      .toBeInTheDocument();
    await expect.element(page.getByText('not valid json {{{')).toBeInTheDocument();
  });

  it('collapses an expanded row back down when Hide details is clicked', async () => {
    render(RepositoryWebhooksPage, { data: createData() });

    const toggleButton = page.getByRole('button', { name: /Show details/ }).first();
    await toggleButton.click();
    await expect
      .element(page.getByRole('button', { name: /Hide details/ }).first())
      .toBeInTheDocument();

    await page
      .getByRole('button', { name: /Hide details/ })
      .first()
      .click();

    await expect
      .element(page.getByRole('button', { name: /Show details/ }).first())
      .toBeInTheDocument();
    await expect
      .element(page.getByText("This event's stored payload was not valid JSON.", { exact: false }))
      .not.toBeInTheDocument();
  });

  it('shows the related issue number when a webhook event references an issue', async () => {
    render(RepositoryWebhooksPage, {
      data: createData({
        events: [createEvent({ prNumber: null, issueNumber: 7, ref: null, commitSha: null })],
      }),
    });

    await expect.element(page.getByText('Issue #7')).toBeInTheDocument();
  });

  it('renders the action filter options from the loaded filter options', async () => {
    render(RepositoryWebhooksPage, {
      data: createData({ filterOptions: { eventTypes: ['push'], actions: ['opened', 'closed'] } }),
    });

    await expect.element(page.getByRole('option', { name: 'opened' })).toBeInTheDocument();
    await expect.element(page.getByRole('option', { name: 'closed' })).toBeInTheDocument();
  });

  it('navigates to the next page while preserving the current URL and filters', async () => {
    mocks.svelteKitPage.url = new URL(
      'http://localhost/repositories/42/webhooks?webhook_event_type=push',
    );
    render(RepositoryWebhooksPage, {
      data: createData({ totalCount: 60, perPage: 25, page: 1 }),
    });

    await page.getByRole('button', { name: 'Go to next page' }).click();

    expect(mocks.goto).toHaveBeenCalledTimes(1);
    const [url, options] = mocks.goto.mock.calls[0];
    expect(new URL(url).searchParams.get('webhook_page')).toBe('2');
    expect(new URL(url).searchParams.get('webhook_event_type')).toBe('push');
    expect(options).toEqual({ keepFocus: true, noScroll: true });
  });
});
