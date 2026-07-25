import { createRawSnippet } from 'svelte';
import { page as browserPage } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import Cat from 'lucide-svelte/icons/cat';
import Page from './page.svelte';
import PageMultiActionFixture from './page-multi-action-fixture.svelte';
// Component tests mount in isolation, without the root layout that normally
// loads these. The narrow-viewport overflow test below renders real Cinder
// `Button`/`Link` components and measures real pixel widths — without the
// underlying `--cinder-*` tokens and Tribunal's own `--space-*` tokens, those
// components render essentially unstyled (no padding, wrong font size),
// which would understate their real width and let the test pass even if the
// fix didn't actually prevent overflow with production content.
import '@lostgradient/cinder/styles';
import '$lib/styles/tokens.css';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<p>Body content</p>',
}));

// No viewport is configured globally (the ambient default is Playwright's
// own 1280x720), so this file picks the same explicit narrow baseline
// authenticated-layout.svelte.test.ts already uses, and resets to it in
// afterEach so a resize in one test doesn't leak into the next.
const DEFAULT_VIEWPORT = [375, 667] as const;

describe('Page', () => {
  afterEach(async () => {
    cleanup();
    await browserPage.viewport(...DEFAULT_VIEWPORT);
  });

  it('renders the title, description, and children', async () => {
    render(Page, {
      title: 'Repositories',
      description: 'Manage watched repositories.',
      children: childrenSnippet,
    });

    await expect.element(browserPage.getByRole('heading', { name: 'Repositories' })).toBeVisible();
    await expect.element(browserPage.getByText('Body content')).toBeVisible();
  });

  it('renders a leading icon when one is provided', async () => {
    render(Page, {
      title: 'Agents',
      // lucide-svelte icon components predate Svelte 5's Component type;
      // the cast is test-only looseness for a render prop.
      icon: Cat as unknown as import('svelte').Component,
      children: childrenSnippet,
    });

    const heading = browserPage.getByRole('heading', { name: 'Agents' });
    await expect.element(heading).toBeVisible();
    const container = document.querySelector('.page-icon-container');
    expect(container?.querySelector('svg')).toBeTruthy();
  });

  // Regression test for the "canyon of whitespace" / "scattered action row"
  // complaint: an actions snippet with several sibling root nodes (e.g. a
  // Link followed by three Buttons, as on the pull-requests page) used to
  // become several independent flex items in `.page-header-row`, which
  // `justify-content: space-between` spread evenly across the whole row
  // instead of clustering them together on the right. `createRawSnippet`
  // cannot construct a multi-root snippet (its `render` must return a single
  // element), so this uses a small fixture component with a real multi-node
  // `{#snippet actions()}` block instead.
  it('wraps a multi-node actions snippet in a single flex item instead of scattering it', async () => {
    const { container } = render(PageMultiActionFixture, {
      children: childrenSnippet,
    });

    const row = container.querySelector('.page-header-row');
    const actionsWrapper = container.querySelector('.page-header-actions');
    expect(actionsWrapper).toBeTruthy();

    // Before the fix, every one of the snippet's root nodes (a Link and
    // three Buttons here) became an independent flex item alongside the
    // leading title group — five siblings for `justify-content: space-between`
    // to spread across the whole row. Now the row has exactly two flex items
    // (leading group, actions wrapper), and every action node lives inside
    // the wrapper instead.
    expect(row?.children.length).toBe(2);
    expect(actionsWrapper?.children.length).toBe(4);
  });

  it('keeps the title and actions on one line when there is enough width', async () => {
    await browserPage.viewport(1280, 800);

    const { container } = render(PageMultiActionFixture, {
      children: childrenSnippet,
    });

    const leadingRect = container.querySelector('.page-header-leading')?.getBoundingClientRect();
    const actionsRect = container.querySelector('.page-header-actions')?.getBoundingClientRect();

    expect(leadingRect).toBeTruthy();
    expect(actionsRect).toBeTruthy();
    // Same line: their vertical ranges overlap (raw `top` can differ even on
    // one line, since `align-items: center` centers items of different
    // heights around the same flex-line baseline rather than aligning tops).
    expect(actionsRect!.top).toBeLessThan(leadingRect!.bottom);
    expect(actionsRect!.bottom).toBeGreaterThan(leadingRect!.top);
  });

  // Regression test for a follow-up review comment on the Part 1 fix:
  // `.page-header-actions` has `flex-shrink: 0` (deliberately, so its buttons
  // never get squeezed illegibly), but with no escape valve that means a
  // narrow viewport plus a wide action group would overflow the row
  // horizontally instead of degrading gracefully. Measured with REAL Cinder
  // `Button`/`Link` components (see the fixture's own comment) — a first
  // attempt at this fix that only wrapped `.page-header-row` passed against
  // bare `<a>`/`<button>` elements but still overflowed by 62px against real,
  // padded Buttons with icons (405px of content in a 343px line). The real
  // fix needed two escape valves: `.page-header-row` wraps so the actions
  // group can drop to its own line, and `.page-header-actions` itself gets
  // `flex-wrap: wrap; max-width: 100%` so its own buttons wrap across
  // multiple lines when even a full line's width isn't enough.
  it('wraps the actions onto their own line, and the buttons within it, instead of overflowing at a narrow viewport', async () => {
    await browserPage.viewport(...DEFAULT_VIEWPORT);

    const { container } = render(PageMultiActionFixture, {
      children: childrenSnippet,
    });

    const leadingRect = container.querySelector('.page-header-leading')?.getBoundingClientRect();
    const actionsRect = container.querySelector('.page-header-actions')?.getBoundingClientRect();
    const row = container.querySelector('.page-header-row') as HTMLElement;
    const actionsElement = container.querySelector('.page-header-actions') as HTMLElement;

    expect(leadingRect).toBeTruthy();
    expect(actionsRect).toBeTruthy();

    // Wrapped onto its own line, below the title.
    expect(actionsRect!.top).toBeGreaterThanOrEqual(leadingRect!.bottom);
    // No horizontal overflow anywhere: neither the row nor the actions group
    // itself has content wider than its own box, i.e. nothing forces the
    // page to scroll sideways.
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    expect(actionsElement.scrollWidth).toBeLessThanOrEqual(actionsElement.clientWidth + 1);
    expect(actionsRect!.right).toBeLessThanOrEqual(DEFAULT_VIEWPORT[0] + 1);

    // Filling the full line width (via `max-width: 100%`) means the old
    // `margin-inline-start: auto` on the wrapper has no leftover space left
    // to push against, so `justify-content: flex-end` is what keeps the
    // wrapped buttons right-aligned instead of defaulting to flex-start.
    const lastAction = actionsElement.lastElementChild as HTMLElement;
    expect(lastAction).toBeTruthy();
    expect(lastAction.getBoundingClientRect().right).toBeCloseTo(actionsRect!.right, 0);
  });
});
