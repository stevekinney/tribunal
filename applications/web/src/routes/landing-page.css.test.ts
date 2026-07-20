import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const markup = readFileSync(resolve(__dir, './+page.svelte'), 'utf-8');

describe('landing page dark-theme tokens', () => {
  it('does not pin local dark-arm token values', () => {
    /*
     * Regression guard: the landing page used to hardcode --text and
     * --surface-raised oklch values inside a `.landing-page[data-theme='dark']`
     * block, working around a stale claim that light-dark() tokens don't
     * re-evaluate under a scoped data-theme subtree. The shared token layer
     * (applications/web/src/lib/styles/tokens.css) already flips
     * `color-scheme` for any `[data-theme='dark']` element, so light-dark()
     * tokens resolve correctly without a page-local copy of the values.
     */
    expect(markup).not.toMatch(/\.landing-page\[data-theme=['"]dark['"]\]/);
    // Match `oklch` anywhere in the declaration's value (not just directly
    // after the colon) so a reintroduction wrapped in light-dark(), e.g.
    // `--text: light-dark(oklch(...), oklch(...));`, is still caught.
    expect(markup).not.toMatch(/--text:[^;]*oklch/);
    expect(markup).not.toMatch(/--surface-raised:[^;]*oklch/);
  });
});
