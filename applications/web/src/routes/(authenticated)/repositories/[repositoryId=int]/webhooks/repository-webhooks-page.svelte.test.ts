import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import RepositoryWebhooksPage from './+page.svelte';
import type { PageData } from './$types';
import type { WebhookEventRow } from '$lib/server/webhook-events';

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

    await expect
      .element(page.getByText("This event's stored payload was not valid JSON.", { exact: false }))
      .toBeInTheDocument();
    await expect.element(page.getByText('not valid json {{{')).toBeInTheDocument();
  });
});
