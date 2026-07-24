import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import EventListenerForm from './event-listener-form.svelte';

const agents = [{ id: 'agent_1', slug: 'triage-agent', enabled: true }];
const eventTypeOptions = ['issues', 'pull_request'];
const actionsByEventType = {
  issues: ['opened', 'closed'],
  pull_request: ['opened', 'synchronize'],
};

describe('event-listener-form', () => {
  afterEach(() => cleanup());

  it('resets the selected action when the event type changes', async () => {
    render(EventListenerForm, {
      mode: 'new',
      listener: null,
      listenerFilters: {},
      agents,
      eventTypeOptions,
      actionsByEventType,
      form: null,
      cancelHref: '/repositories/42/events',
    });

    await page.getByLabelText('Event type').selectOptions('pull_request');
    await page.getByLabelText('Action').selectOptions('synchronize');
    await expect.element(page.getByLabelText('Action')).toHaveValue('synchronize');

    await page.getByLabelText('Event type').selectOptions('issues');

    await expect.element(page.getByLabelText('Action')).toHaveValue('');
  });

  it('preserves an existing listener action not in the observed set on first render', async () => {
    render(EventListenerForm, {
      mode: 'edit',
      listener: {
        id: 'listener_1',
        userId: 1,
        repositoryId: 42,
        name: 'Existing',
        enabled: true,
        eventType: 'issues',
        action: 'archaic_action',
        filtersJson: '{}',
        agentId: 'agent_1',
        instructionsMarkdown: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      listenerFilters: {},
      agents,
      eventTypeOptions,
      actionsByEventType,
      form: null,
      cancelHref: '/repositories/42/events',
    });

    await expect.element(page.getByLabelText('Action')).toHaveValue('archaic_action');
  });

  it('uses a checkbox for the deferred enabled value', async () => {
    render(EventListenerForm, {
      mode: 'new',
      listener: null,
      listenerFilters: {},
      agents,
      eventTypeOptions,
      actionsByEventType,
      form: null,
      cancelHref: '/repositories/42/events',
    });

    const enabledCheckbox = page.getByRole('checkbox', { name: 'Enabled' });
    await expect.element(enabledCheckbox).toBeChecked();
    await expect.element(enabledCheckbox).toHaveAttribute('name', 'enabled');
  });

  it('uses a checkbox for invalid-filter acknowledgement and preserves explicit false submission', async () => {
    const { container } = render(EventListenerForm, {
      mode: 'edit',
      listener: null,
      listenerFilters: {},
      listenerFiltersInvalid: true,
      agents,
      eventTypeOptions,
      actionsByEventType,
      form: null,
      cancelHref: '/repositories/42/events',
    });

    const acknowledgement = page.getByRole('checkbox', {
      name: 'I understand this replaces the invalid filters below.',
    });
    await expect.element(acknowledgement).not.toBeChecked();
    expect(
      container.querySelector<HTMLInputElement>('input[name="acknowledgeFiltersReset"]')?.value,
    ).toBe('false');

    await acknowledgement.click();

    expect(
      container.querySelector<HTMLInputElement>('input[name="acknowledgeFiltersReset"]')?.value,
    ).toBe('true');
  });

  it('submits edited instructions markdown through the existing instructions field', async () => {
    const { container } = render(EventListenerForm, {
      mode: 'new',
      listener: null,
      listenerFilters: {},
      agents,
      eventTypeOptions,
      actionsByEventType,
      form: null,
      cancelHref: '/repositories/42/events',
    });

    await page.getByLabelText('Instructions').fill('Summarize the event and assign a label.');

    expect(
      container.querySelector<HTMLInputElement>('input[name="instructionsMarkdown"]')?.value,
    ).toBe('Summarize the event and assign a label.');
  });
});
