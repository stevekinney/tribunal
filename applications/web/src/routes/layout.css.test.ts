import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dir, './layout.css'), 'utf-8');

describe('layout.css @layer ordering', () => {
  it('declares the cascade layer order explicitly', () => {
    /*
     * This test guards the @layer ordering contract in layout.css.
     * The declaration interleaves Cinder and Tribunal layers so that
     * Tribunal tokens win over Cinder tokens, while Cinder owns every
     * base element reset via cinder.foundation. Changing this order
     * will silently invert CSS specificity for the entire app.
     *
     * If you need to change the layer order, update this test to match.
     */
    expect(css).toContain(
      '@layer cinder.tokens, cinder.foundation, cinder.components, cinder.utilities,\n  utilities, components, tokens;',
    );
  });

  it('does not reintroduce a bare Tribunal foundation layer', () => {
    /*
     * Regression guard: the app's former foundation.css was a verbatim,
     * token-drifted clone of cinder.foundation. Because cross-stylesheet
     * layer order is fixed at first encounter (Vite dev sorted the app's
     * implicit `foundation` layer AFTER all of Cinder's), it clobbered
     * Cinder component styling — most visibly, primary buttons rendered
     * inherited dark text over the indigo accent. Cinder's foundation now
     * owns the resets; reintroducing a bare `foundation` layer would
     * resurrect that bug.
     */
    // Extract the `@layer ...;` declaration and inspect its layer names.
    const layerStatement = css.match(/@layer\s+([^;{]+);/);
    expect(layerStatement).not.toBeNull();
    const layerNames = layerStatement![1].split(',').map((name) => name.trim());
    // `cinder.foundation` is allowed; a standalone `foundation` is the bug.
    expect(layerNames).not.toContain('foundation');
    // The clone file must not be imported back in (a prose mention in the
    // explanatory comment is fine; an actual @import is the regression).
    expect(css).not.toMatch(/@import\s+['"][^'"]*foundation\.css/);
  });

  it('imports the Cinder base stylesheet after the @layer declaration', () => {
    const layerIndex = css.indexOf('@layer cinder.tokens');
    const cinderImportIndex = css.indexOf("@import '@lostgradient/cinder/styles';");
    expect(cinderImportIndex).toBeGreaterThan(layerIndex);
  });
});
