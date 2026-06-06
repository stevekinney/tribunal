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
     * Tribunal tokens win over Cinder tokens, and Cinder component
     * styles win over Tribunal element resets. Changing this order
     * will silently invert CSS specificity for the entire app.
     *
     * If you need to change the layer order, update this test to match.
     */
    expect(css).toContain(
      '@layer cinder.tokens, cinder.foundation, foundation, cinder.components,\n  cinder.utilities, utilities, components, tokens;',
    );
  });

  it('imports Cinder styles after the @layer declaration', () => {
    const layerIndex = css.indexOf('@layer cinder.tokens');
    const cinderImportIndex = css.indexOf("@import '@lostgradient/cinder/styles'");
    expect(cinderImportIndex).toBeGreaterThan(layerIndex);
  });
});
