/**
 * The editor's `value` binding is debounced, so submitting shortly after typing
 * would post the previous markdown and silently drop the user's last edit. The
 * form reads the live document through the editor handle at submit time instead.
 *
 * This lives in its own file because it mocks the editor module, and the sibling
 * suite renders the same form against the real one.
 */
import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { LIVE_EDITOR_MARKDOWN } from './event-listener-editor-stub.svelte';

/** Records the FormData the form's submit function actually sees. */
const submitted: { formData?: FormData } = {};

vi.mock('@lostgradient/editor/markdown-editor', async () => ({
  MarkdownEditor: (await import('./event-listener-editor-stub.svelte')).default,
}));

/**
 * Mirrors `use:enhance` closely enough for this test: intercepts the native
 * submit, builds the FormData the real implementation would build from the form
 * element, and hands it to the submit function so its mutations are observable.
 * It never POSTs -- there is no server here, and exercising SvelteKit's own
 * progressive-enhancement plumbing is that project's job, not this one's.
 */
vi.mock('$app/forms', () => ({
  enhance: (
    formElement: HTMLFormElement,
    submitFunction?: (input: { formData: FormData; formElement: HTMLFormElement }) => unknown,
  ) => {
    const handleSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      const formData = new FormData(formElement);
      submitFunction?.({ formData, formElement });
      submitted.formData = formData;
    };

    formElement.addEventListener('submit', handleSubmit);
    return {
      destroy() {
        formElement.removeEventListener('submit', handleSubmit);
      },
    };
  },
}));

const { default: EventListenerForm } = await import('./event-listener-form.svelte');

const STALE_BOUND_MARKDOWN = 'stale bound content';

const agents = [{ id: 'agent_1', slug: 'triage-agent', enabled: true }];
const eventTypeOptions = ['issues'];
const actionsByEventType = { issues: ['opened'] };

describe('event-listener-form submit', () => {
  it('submits the editor live document rather than the debounced binding', async () => {
    render(EventListenerForm, {
      mode: 'edit',
      listener: {
        id: 'listener_1',
        userId: 1,
        repositoryId: 42,
        name: 'Existing',
        enabled: true,
        eventType: 'issues',
        action: 'opened',
        filtersJson: '{}',
        agentId: 'agent_1',
        // Seeds the bindable, so this is what a debounced submit would post.
        instructionsMarkdown: STALE_BOUND_MARKDOWN,
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

    await page.getByRole('button', { name: 'Save listener' }).click();

    await expect.poll(() => submitted.formData).toBeDefined();
    expect(submitted.formData?.get('instructionsMarkdown')).toBe(LIVE_EDITOR_MARKDOWN);
    expect(submitted.formData?.get('instructionsMarkdown')).not.toBe(STALE_BOUND_MARKDOWN);
  });
});
