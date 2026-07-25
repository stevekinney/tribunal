import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import AgentEditor, { AGENT_EDITOR_FORM_ID } from './agent-editor.svelte';

const baseAgent = {
  id: 'agent_security',
  slug: 'security',
  description: 'Finds security issues',
  body: 'Review security changes.',
  model: 'sonnet',
  effort: 'xhigh',
};

const modelOptions = ['inherit', 'sonnet', 'opus', 'haiku', 'fable'] as const;
const effortOptions = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

describe('agent editor', () => {
  afterEach(() => cleanup());

  it('orders identity before the prompt editor before runtime controls', async () => {
    render(AgentEditor, {
      agent: baseAgent,
      defaultModel: 'sonnet',
      modelOptions,
      effortOptions,
      form: null,
      submitLabel: 'Save changes',
    });

    const headings = await page.getByRole('heading', { level: 2 }).all();
    const headingTexts = await Promise.all(
      headings.map((heading) => heading.element().textContent),
    );

    const identityIndex = headingTexts.indexOf('Identity');
    const runtimeIndex = headingTexts.indexOf('Runtime');

    expect(identityIndex).toBeGreaterThanOrEqual(0);
    expect(runtimeIndex).toBeGreaterThan(identityIndex);
    expect(headingTexts).not.toContain('Prompt');
    expect(headingTexts).not.toContain('Agent basics');
  });

  it('does not render a separate prompt preview card', async () => {
    render(AgentEditor, {
      agent: baseAgent,
      defaultModel: 'sonnet',
      modelOptions,
      effortOptions,
      form: null,
      submitLabel: 'Save changes',
    });

    await expect
      .element(page.getByRole('heading', { name: 'Prompt preview' }))
      .not.toBeInTheDocument();
  });

  it('does not render its own enabled control or redundant status indicators', async () => {
    render(AgentEditor, {
      agent: baseAgent,
      defaultModel: 'sonnet',
      modelOptions,
      effortOptions,
      form: null,
      submitLabel: 'Save changes',
    });

    await expect.element(page.getByRole('switch')).not.toBeInTheDocument();
    await expect.element(page.getByRole('checkbox', { name: 'Enabled' })).not.toBeInTheDocument();
    await expect
      .element(page.getByText('Available for repository automation.'))
      .not.toBeInTheDocument();
  });

  it('exposes a stable form id so an external Enabled toggle can associate with it', async () => {
    const { container } = render(AgentEditor, {
      agent: baseAgent,
      defaultModel: 'sonnet',
      modelOptions,
      effortOptions,
      form: null,
      submitLabel: 'Save changes',
    });

    expect(container.querySelector(`form#${AGENT_EDITOR_FORM_ID}[action="?/save"]`)).toBeTruthy();
  });

  it('defaults to the library-provided WYSIWYG editor mode', async () => {
    render(AgentEditor, {
      agent: baseAgent,
      defaultModel: 'sonnet',
      modelOptions,
      effortOptions,
      form: null,
      submitLabel: 'Save changes',
    });

    await expect
      .element(page.getByRole('radio', { name: 'Rich' }))
      .toHaveAttribute('aria-checked', 'true');
    await expect
      .element(page.getByRole('radio', { name: 'Raw' }))
      .toHaveAttribute('aria-checked', 'false');
  });

  it('removes the generic effort helper text but keeps specific fallback warnings', async () => {
    render(AgentEditor, {
      agent: baseAgent,
      defaultModel: 'sonnet',
      modelOptions,
      effortOptions,
      form: null,
      submitLabel: 'Save changes',
    });

    await expect
      .element(page.getByText('Higher effort uses more tokens per review.'))
      .not.toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          'xhigh will be stored, but this model falls back to high effort at runtime.',
        ),
      )
      .toBeVisible();
  });

  it('preserves submitted values and shows the error on a failed save', async () => {
    render(AgentEditor, {
      agent: baseAgent,
      defaultModel: 'sonnet',
      modelOptions,
      effortOptions,
      form: {
        error: 'Slug is already in use.',
        values: {
          slug: 'security',
          description: 'Attempted description',
          body: 'Attempted body',
          model: 'sonnet',
          effort: 'xhigh',
        },
      },
      submitLabel: 'Save changes',
    });

    await expect.element(page.getByText('Slug is already in use.')).toBeVisible();
    await expect.element(page.getByLabelText('Description')).toHaveValue('Attempted description');
  });

  it('submits the committed id returned from a failed new-agent save', async () => {
    const { container } = render(AgentEditor, {
      agent: {
        slug: '',
        description: '',
        body: '',
        model: 'inherit',
        effort: null,
      },
      defaultModel: 'sonnet',
      modelOptions,
      effortOptions,
      form: {
        error: 'Review engine wake-up failed. Please try again.',
        values: {
          id: 'agent_committed',
          slug: 'security',
          description: 'Attempted description',
          body: 'Attempted body',
          model: 'sonnet',
          effort: 'xhigh',
        },
      },
      submitLabel: 'Create agent',
    });

    expect(container.querySelector<HTMLInputElement>('input[name="id"]')?.value).toBe(
      'agent_committed',
    );
  });

  it('renders the markdown editor formatting toolbar', async () => {
    render(AgentEditor, {
      agent: baseAgent,
      defaultModel: 'sonnet',
      modelOptions,
      effortOptions,
      form: null,
      submitLabel: 'Save changes',
    });

    await expect
      .element(page.getByRole('toolbar', { name: 'Formatting toolbar' }))
      .toBeInTheDocument();
  });

  it('submits edited prompt markdown through the existing body field', async () => {
    const { container } = render(AgentEditor, {
      agent: baseAgent,
      defaultModel: 'sonnet',
      modelOptions,
      effortOptions,
      form: null,
      submitLabel: 'Save changes',
    });

    // The editor now defaults to WYSIWYG mode, where "System prompt" labels both
    // the outer application region and the inner ProseMirror textbox. Switch to
    // Raw mode first so the label resolves to the single source textarea.
    await page.getByRole('radio', { name: 'Raw' }).click();
    await page.getByLabelText('System prompt').fill('Review authz changes carefully.');

    expect(container.querySelector<HTMLInputElement>('input[name="body"]')?.value).toBe(
      'Review authz changes carefully.',
    );
  });
});
