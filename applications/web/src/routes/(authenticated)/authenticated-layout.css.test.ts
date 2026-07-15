import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(resolve(directory, './+layout.svelte'), 'utf-8');

describe('authenticated layout sidebar styles', () => {
  it("uses Cinder's public mobile media query contract for layout state", () => {
    expect(layout).toMatch(/new MediaQuery\(\s*SIDEBAR_MOBILE_MEDIA_QUERY,\s*false\s*\)/);
    expect(layout).toMatch(
      /<svelte:element\s+this={'style'}\s+media={SIDEBAR_MOBILE_MEDIA_QUERY}\s*>/,
    );
    expect(layout).not.toContain('47.99rem');
    expect(layout).not.toContain('48rem');
    expect(layout).not.toContain('cinder-sidebar--mobile');
  });

  it('connects the app-owned mobile trigger to the Cinder Sidebar', () => {
    expect(layout).toMatch(/aria-controls="app-sidebar"[\s\S]*aria-expanded={!collapsed}/);
    expect(layout).toMatch(/<Sidebar[\s\S]*id="app-sidebar"/);
  });
});
