import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import EventsPage from './+page.svelte';
import type { PageData } from './$types';

function createListenerRow(
  overrides: Partial<PageData['listeners'][number]['listener']> = {},
): PageData['listeners'][number] {
  return {
    listener: {
      id: 'listener_1',
      userId: 1,
      repositoryId: 42,
      name: 'Triage issues',
      enabled: true,
      eventType: 'issues',
      action: 'opened',
      filtersJson: '{}',
      agentId: 'agent_1',
      instructionsMarkdown: '# Triage',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    },
    agentSlug: 'triage-agent',
    agentEnabled: true,
    lastDelivery: null,
  };
}

function createData(overrides: Partial<PageData> = {}): PageData {
  return {
    repository: { id: 42, owner: 'acme', name: 'widgets' },
    listeners: [],
    agents: [{ id: 'agent_1', slug: 'triage-agent', enabled: true }],
    eventTypeOptions: ['issues', 'pull_request'],
    actionsByEventType: { issues: ['opened', 'closed'] },
    editing: null,
    editingListener: null,
    editingListenerFilters: {},
    ...overrides,
  } as PageData;
}

describe('/repositories/[repositoryId]/events page', () => {
  afterEach(() => cleanup());

  it('shows an empty state explaining what event listeners do', async () => {
    render(EventsPage, { data: createData(), form: null });

    await expect.element(page.getByRole('heading', { name: 'No event listeners' })).toBeVisible();
    await expect
      .element(
        page.getByText(
          'Event listeners run an agent whenever a matching GitHub webhook delivery arrives for this repository.',
        ),
      )
      .toBeVisible();
  });

  it('lists a listener with name, event/action, agent, enabled state, and last run status', async () => {
    render(EventsPage, {
      data: createData({ listeners: [createListenerRow()] }),
      form: null,
    });

    await expect.element(page.getByText('Triage issues', { exact: true })).toBeVisible();
    await expect.element(page.getByRole('cell', { name: 'issues opened' })).toBeVisible();
    await expect.element(page.getByText('triage-agent')).toBeVisible();
    await expect
      .element(page.getByRole('switch', { name: 'Disable Triage issues' }))
      .toHaveAttribute('aria-checked', 'true');
    await expect.element(page.getByText('No runs yet')).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Manage' }))
      .toHaveAttribute('href', '/repositories/42/events?listener=listener_1');
  });

  it('shows the last matched delivery and run status, without a link to the run', async () => {
    // `/runs/[runId]` only supports pull-request-review runs today, and a
    // listener's dispatched run is always a `webhook_event_handler` run --
    // linking there would always 404. No link until the run inspector
    // supports webhook runs.
    render(EventsPage, {
      data: createData({
        listeners: [
          {
            ...createListenerRow(),
            lastDelivery: {
              id: 1,
              matchedAt: new Date('2026-01-02T00:00:00.000Z'),
              deliveryStatus: 'succeeded',
              runId: 'run:webhook:1',
              runStatus: 'running',
              lastError: null,
              displayStatus: 'running',
            },
          },
        ],
      }),
      form: null,
    });

    await expect.element(page.getByText('Running')).toBeVisible();
    expect(document.body.textContent).not.toContain('View run');
  });

  it('opens the create form when linking to ?listener=new', async () => {
    render(EventsPage, {
      data: createData({ editing: 'new', editingListener: null, editingListenerFilters: {} }),
      form: null,
    });

    await expect.element(page.getByRole('heading', { name: 'New event listener' })).toBeVisible();
    await expect.element(page.getByLabelText('Name')).toHaveValue('');
  });

  it('opens the edit form pre-filled with the listener being edited, preserving its instructions', async () => {
    const listener = createListenerRow().listener;
    render(EventsPage, {
      data: createData({
        listeners: [createListenerRow()],
        editing: listener.id,
        editingListener: listener,
        editingListenerFilters: {},
      }),
      form: null,
    });

    await expect.element(page.getByRole('heading', { name: 'Edit event listener' })).toBeVisible();
    await expect.element(page.getByLabelText('Name')).toHaveValue('Triage issues');
  });

  it('shows a delete confirmation dialog rather than deleting directly from the list', async () => {
    render(EventsPage, {
      data: createData({ listeners: [createListenerRow()] }),
      form: null,
    });

    await expect
      .element(page.getByRole('dialog', { name: 'Delete event listener' }))
      .not.toBeInTheDocument();

    await page.getByRole('button', { name: 'Delete Triage issues' }).click();

    await expect
      .element(page.getByRole('dialog', { name: 'Delete event listener' }))
      .toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  });

  it('shows a server-side error message when the form action fails', async () => {
    render(EventsPage, {
      data: createData({ editing: 'new' }),
      form: { error: 'Select an agent.' },
    });

    await expect.element(page.getByText('Select an agent.')).toBeVisible();
  });
});
