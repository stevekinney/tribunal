import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import AgentEditor from './agent-editor.svelte';

const baseAgent = {
  id: 'agent_security',
  slug: 'security',
  description: 'Finds security issues',
  body: 'Review security changes.',
  model: 'sonnet',
  effort: 'xhigh',
  enabled: true,
};

const modelOptions = ['inherit', 'sonnet', 'opus', 'haiku', 'fable'] as const;
const effortOptions = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

describe('agent editor', () => {
  afterEach(() => cleanup());

  it('orders agent basics before the prompt editor before runtime controls', async () => {
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

    const basicsIndex = headingTexts.indexOf('Agent basics');
    const promptIndex = headingTexts.indexOf('Prompt');
    const runtimeIndex = headingTexts.indexOf('Runtime');

    expect(basicsIndex).toBeGreaterThanOrEqual(0);
    expect(promptIndex).toBeGreaterThan(basicsIndex);
    expect(runtimeIndex).toBeGreaterThan(promptIndex);
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

  it('shows availability copy that is not review-specific', async () => {
    render(AgentEditor, {
      agent: baseAgent,
      defaultModel: 'sonnet',
      modelOptions,
      effortOptions,
      form: null,
      submitLabel: 'Save changes',
    });

    await expect.element(page.getByText('Available for repository automation.')).toBeVisible();
    await expect.element(page.getByText('Runs on watched repositories.')).not.toBeInTheDocument();
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
          enabled: false,
        },
      },
      submitLabel: 'Save changes',
    });

    await expect.element(page.getByText('Slug is already in use.')).toBeVisible();
    await expect.element(page.getByLabelText('Description')).toHaveValue('Attempted description');
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

    await page.getByLabelText('System prompt').fill('Review authz changes carefully.');

    expect(container.querySelector<HTMLInputElement>('input[name="body"]')?.value).toBe(
      'Review authz changes carefully.',
    );
  });
});
