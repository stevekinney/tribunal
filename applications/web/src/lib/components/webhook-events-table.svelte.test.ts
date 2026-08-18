import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import WebhookEventsTable from './webhook-events-table.svelte';
import type { WebhookEventRow } from '$lib/server/webhook-events';

function event(id = 1): WebhookEventRow {
  return {
    id,
    eventType: 'push',
    action: null,
    deliveryId: `delivery-${id}`,
    repositoryId: 42,
    repositoryOwner: 'acme',
    repositoryName: 'widgets',
    installationId: null,
    senderLogin: null,
    prNumber: null,
    issueNumber: null,
    ref: null,
    commitSha: null,
    receivedAt: '2026-01-01T00:00:00.000Z',
    githubCreatedAt: null,
    listenerProgress: {
      receivedOnly: true,
      matchCount: 0,
      matchedListenerNames: [],
      status: 'received_only',
      hasError: false,
      matches: [],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderTable(events = [event()]) {
  return render(WebhookEventsTable, {
    props: {
      events,
      emptyTitle: 'No events',
      emptyDescription: 'No events received.',
    },
  } as never);
}

describe('WebhookEventsTable payload loading', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows loading on first expand and renders a valid fetched payload', async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn(() => response.promise);
    vi.stubGlobal('fetch', fetchMock);
    renderTable();

    await page.getByRole('button', { name: /Show details/ }).click();
    await expect.element(page.getByRole('status')).toHaveTextContent('Loading webhook payload');
    expect(fetchMock).toHaveBeenCalledWith('/api/webhook-events/1/payload');

    response.resolve(
      new Response(JSON.stringify({ payload: { repository: 'acme/widgets' }, parseError: false })),
    );
    await expect.element(page.getByText('Webhook payload')).toBeInTheDocument();
    await expect.element(page.getByText('repository:', { exact: true })).toBeInTheDocument();
  });

  it('renders malformed payload text after a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ payload: 'not valid json {{{', parseError: true })),
        ),
    );
    renderTable();

    await page.getByRole('button', { name: /Show details/ }).click();
    await expect
      .element(page.getByRole('alert').getByText('Parse error:', { exact: false }))
      .toBeInTheDocument();
    await expect.element(page.getByText('not valid json {{{', { exact: true })).toBeInTheDocument();
  });

  it('uses one request across concurrent expansion and collapse/re-expand', async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn(() => response.promise);
    vi.stubGlobal('fetch', fetchMock);
    renderTable([event(1), event(2)]);

    await page.getByRole('button', { name: /Show details.*delivery-1/ }).click();
    await page.getByRole('button', { name: /Show details.*delivery-2/ }).click();
    await page.getByRole('button', { name: /Hide details.*delivery-1/ }).click();
    await page.getByRole('button', { name: /Show details.*delivery-1/ }).click();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    response.resolve(new Response(JSON.stringify({ payload: { ok: true }, parseError: false })));
    await expect.element(page.getByText('Webhook payload').first()).toBeInTheDocument();
    await page.getByRole('button', { name: /Hide details.*delivery-1/ }).click();
    await page.getByRole('button', { name: /Show details.*delivery-1/ }).click();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('removes failed responses from the cache and retries them', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ payload: { retried: true }, parseError: false })),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderTable();

    await page.getByRole('button', { name: /Show details/ }).click();
    await expect.element(page.getByText('Unable to load webhook payload.')).toBeInTheDocument();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect.element(page.getByText('Webhook payload')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows the retry state for an invalid successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{')));
    renderTable();

    await page.getByRole('button', { name: /Show details/ }).click();

    await expect.element(page.getByText('Unable to load webhook payload.')).toBeInTheDocument();
  });
});
