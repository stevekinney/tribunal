import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import WebhooksPage from './+page.svelte';
import type { PageData } from './$types';
import type { WebhookEventRow } from '$lib/server/webhook-events';

const mockGoto = vi.hoisted(() => vi.fn());

vi.mock('$app/navigation', () => ({ goto: mockGoto }));
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/webhooks?webhook_event_type=pull_request') },
}));

function createEvent(overrides: Partial<WebhookEventRow> = {}): WebhookEventRow {
  return {
    id: 1,
    eventType: 'pull_request',
    action: 'opened',
    deliveryId: 'delivery-1',
    repositoryId: 42,
    repositoryOwner: 'acme',
    repositoryName: 'widgets',
    installationId: 99,
    senderLogin: 'octocat',
    prNumber: 7,
    issueNumber: null,
    ref: null,
    commitSha: null,
    receivedAt: '2026-01-01T00:00:00.000Z',
    githubCreatedAt: null,
    rawPayload: '{"ok":true}',
    payload: { ok: true },
    payloadParseError: false,
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
    hasRepositories: true,
    repositories: [{ id: 42, owner: 'acme', name: 'widgets' }],
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
    filterOptions: { eventTypes: ['pull_request'], actions: ['opened'] },
    subscribedEventTypes: ['pull_request', 'push'],
    loadError: null,
    ...overrides,
  } as PageData;
}

describe('/webhooks page', () => {
  afterEach(() => {
    cleanup();
    mockGoto.mockReset();
  });

  it('lists webhook events with repository, event/action, and delivery ID', async () => {
    render(WebhooksPage, { data: createData() });

    await expect.element(page.getByRole('link', { name: 'acme/widgets' })).toBeInTheDocument();
    await expect
      .element(page.getByRole('cell', { name: 'pull_request opened' }))
      .toBeInTheDocument();
    await expect.element(page.getByText('delivery-1', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('PR #7')).toBeInTheDocument();
  });

  it('wraps the events table in a named, focusable scroll region', async () => {
    render(WebhooksPage, { data: createData() });

    const scrollRegion = page.getByRole('region', { name: 'Webhook events' });
    await expect.element(scrollRegion).toBeInTheDocument();
    await expect.element(scrollRegion).toHaveAttribute('tabindex', '0');
  });

  it('shows the subscribed events summary', async () => {
    render(WebhooksPage, { data: createData() });

    await expect.element(page.getByText('Subscribed events')).toBeInTheDocument();
    await expect.element(page.getByText('push')).toBeInTheDocument();
  });

  it('shows a "no repositories" empty state distinct from "no events match"', async () => {
    render(WebhooksPage, {
      data: createData({ hasRepositories: false, repositories: [], events: [], totalCount: 0 }),
    });

    await expect.element(page.getByText('No repositories added')).toBeInTheDocument();
  });

  it('shows a load error distinct from the "no repositories" empty state when GitHub is unreachable', async () => {
    render(WebhooksPage, {
      data: createData({
        hasRepositories: false,
        repositories: [],
        events: [],
        totalCount: 0,
        loadError: 'Could not reach GitHub to list your installations. Please try again.',
      }),
    });

    await expect
      .element(
        page.getByText('Could not reach GitHub to list your installations.', { exact: false }),
      )
      .toBeInTheDocument();
    expect(document.body.textContent).not.toContain('No repositories added');
  });

  it('suppresses the events table and filters entirely during a load error, instead of a synthetic empty-events result', async () => {
    // The server returns `loadError` alongside a synthetic empty `events`
    // array when it could not determine repository/event state (GitHub
    // outage). Rendering the filters form and the events table's own
    // "No webhook events received" empty state would misleadingly imply we
    // queried and found nothing, rather than never having queried at all.
    render(WebhooksPage, {
      data: createData({
        hasRepositories: true,
        events: [],
        totalCount: 0,
        loadError: 'Could not reach GitHub to list your installations. Please try again.',
      }),
    });

    await expect
      .element(
        page.getByText('Could not reach GitHub to list your installations.', { exact: false }),
      )
      .toBeInTheDocument();
    expect(document.body.textContent).not.toContain('No webhook events received');
    expect(document.body.textContent).not.toContain('Apply filters');
  });

  it('shows a filtered-empty state when repositories exist but no events match', async () => {
    render(WebhooksPage, {
      data: createData({
        events: [],
        totalCount: 0,
        filters: {
          eventType: 'issues',
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
      }),
    });

    await expect
      .element(page.getByText('No webhook events match these filters'))
      .toBeInTheDocument();
  });

  it('shows installation ID, sender, related object, and GitHub timestamp in the expanded detail', async () => {
    render(WebhooksPage, {
      data: createData({
        events: [createEvent({ githubCreatedAt: '2026-01-01T00:00:00.000Z' })],
      }),
    });

    await page.getByRole('button', { name: /Show details/ }).click();

    await expect.poll(() => document.getElementById('webhook-event-detail-1')).not.toBeNull();
    const detail = document.getElementById('webhook-event-detail-1');
    const metadataList = detail?.querySelector('.cinder-description-list');
    expect(metadataList).not.toBeNull();
    const detailText = detail?.textContent ?? '';
    expect(detailText).toContain('Event');
    expect(detailText).toContain('pull_request · opened');
    expect(detailText).toContain('Repository');
    expect(detailText).toContain('acme/widgets');
    expect(detailText).toContain('Installation ID');
    expect(detailText).toContain('99');
    expect(detailText).toContain('Sender');
    expect(detailText).toContain('octocat');
    expect(detailText).toContain('Related object');
    expect(detailText).toContain('PR #7');
    expect(detailText).toContain('GitHub timestamp');
    expect(detailText).toContain('Received');
    expect(detailText).toContain('Delivery ID');
    expect(detailText).toContain('delivery-1');
  });

  it('renders valid payloads with the Cinder payload inspector label', async () => {
    render(WebhooksPage, {
      data: createData({
        events: [
          createEvent({
            payload: {
              repository: {
                owner: {
                  login: 'acme',
                },
              },
            },
            rawPayload: '{"repository":{"owner":{"login":"acme"}}}',
          }),
        ],
      }),
    });

    await page.getByRole('button', { name: /Show details/ }).click();

    await expect.element(page.getByText('Webhook payload')).toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: 'Copy Webhook payload' }))
      .toBeInTheDocument();
    await expect.element(page.getByText('repository:', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('"acme"')).not.toBeInTheDocument();
  });

  it('renders raw invalid payloads through the Cinder payload inspector', async () => {
    render(WebhooksPage, {
      data: createData({
        events: [
          createEvent({
            payload: null,
            rawPayload: 'not valid json {{{',
            payloadParseError: true,
          }),
        ],
      }),
    });

    await page.getByRole('button', { name: /Show details/ }).click();

    await expect
      .element(page.getByRole('alert').getByText('Parse error:', { exact: false }))
      .toBeInTheDocument();
    await expect.element(page.getByText('Webhook payload')).toBeInTheDocument();
    await expect.element(page.getByText('not valid json {{{', { exact: true })).toBeInTheDocument();
  });

  it('shows a matched listener and its status badge, without a link to its run', async () => {
    // `/runs/[runId]` only supports pull-request-review runs today, and a
    // listener match's run is always a `webhook_event_handler` run --
    // linking there would always 404. No link until the run inspector
    // supports webhook runs.
    render(WebhooksPage, {
      data: createData({
        events: [
          createEvent({
            listenerProgress: {
              receivedOnly: false,
              matchCount: 1,
              matchedListenerNames: ['Triage issues'],
              status: 'running',
              hasError: false,
              matches: [
                {
                  deliveryId: 1,
                  listenerId: 'listener_1',
                  listenerName: 'Triage issues',
                  listenerDeleted: false,
                  deliveryStatus: 'succeeded',
                  status: 'running',
                  runId: 'run:webhook:1',
                  lastError: null,
                },
              ],
            },
          }),
        ],
      }),
    });

    await expect.element(page.getByText('Running')).toBeInTheDocument();
    await expect.element(page.getByText('Triage issues')).toBeInTheDocument();

    await page.getByRole('button', { name: /Show details/ }).click();
    await expect
      .element(page.getByRole('link', { name: 'View run' }))
      .toHaveAttribute('href', '/runs/run:webhook:1');
  });

  it('shows a dispatch error as a visible failure, and a delivery with no matches as received-only', async () => {
    render(WebhooksPage, {
      data: createData({
        events: [
          createEvent({
            id: 2,
            listenerProgress: {
              receivedOnly: false,
              matchCount: 1,
              matchedListenerNames: ['Flaky listener'],
              status: 'failed',
              hasError: true,
              matches: [
                {
                  deliveryId: 2,
                  listenerId: 'listener_2',
                  listenerName: 'Flaky listener',
                  listenerDeleted: false,
                  deliveryStatus: 'abandoned',
                  status: 'failed',
                  runId: null,
                  lastError: 'Agent no longer exists',
                },
              ],
            },
          }),
        ],
      }),
    });

    await expect.element(page.getByText('Failed')).toBeInTheDocument();

    await page.getByRole('button', { name: /Show details/ }).click();
    await expect.element(page.getByText('Agent no longer exists')).toBeInTheDocument();
  });

  it('shows a delivery with no matches as received-only, not as an error', async () => {
    render(WebhooksPage, { data: createData() });

    await expect
      .element(page.getByRole('cell', { name: 'Received' }).getByText('Received'))
      .toBeInTheDocument();

    await page.getByRole('button', { name: /Show details/ }).click();
    await expect
      .element(page.getByText('No event listeners matched this delivery.'))
      .toBeInTheDocument();
  });

  it('labels preserved history for a deleted listener', async () => {
    render(WebhooksPage, {
      data: createData({
        events: [
          createEvent({
            listenerProgress: {
              receivedOnly: false,
              matchCount: 1,
              matchedListenerNames: ['Former listener'],
              status: 'cancelled',
              hasError: false,
              matches: [
                {
                  deliveryId: 3,
                  listenerId: null,
                  listenerName: 'Former listener',
                  listenerDeleted: true,
                  deliveryStatus: 'pending',
                  status: 'cancelled',
                  runId: null,
                  lastError: null,
                },
              ],
            },
          }),
        ],
      }),
    });

    await expect.element(page.getByText('Cancelled')).toBeInTheDocument();
    await page.getByRole('button', { name: /Show details/ }).click();
    await expect
      .element(page.getByText('Former listener (deleted)', { exact: true }))
      .toBeInTheDocument();
  });

  it('navigates to the next page, preserving other filters, when pagination is clicked', async () => {
    render(WebhooksPage, {
      data: createData({ page: 1, perPage: 1, totalCount: 2, events: [createEvent()] }),
    });

    await page.getByRole('button', { name: 'Go to next page' }).click();

    expect(mockGoto).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockGoto.mock.calls[0] as [URL];
    expect(calledUrl.searchParams.get('webhook_page')).toBe('2');
    expect(calledUrl.searchParams.get('webhook_event_type')).toBe('pull_request');
  });
});
