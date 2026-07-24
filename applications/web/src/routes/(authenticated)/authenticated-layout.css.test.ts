import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(resolve(directory, './+layout.svelte'), 'utf-8');

describe('authenticated layout sidebar styles', () => {
  it("uses Cinder's public mobile media query contract for layout state", () => {
    const head = layout.slice(layout.indexOf('<svelte:head>'), layout.indexOf('</svelte:head>'));

    expect(layout).toMatch(/new MediaQuery\(\s*SIDEBAR_MOBILE_MEDIA_QUERY,\s*false\s*\)/);
    expect(head).toContain('<svelte:element');
    expect(head).toContain('media={SIDEBAR_MOBILE_MEDIA_QUERY}');
    expect(layout).not.toContain('47.99rem');
    expect(layout).not.toContain('48rem');
    expect(layout).not.toContain('cinder-sidebar--mobile');
  });

  it('connects the Cinder mobile trigger to the Cinder Sidebar', () => {
    const buttonStartIndex = layout.indexOf('<Button');
    const buttonEndIndex =
      layout.indexOf('>', layout.indexOf('aria-expanded', buttonStartIndex)) + 1;
    const mobileMenuButton = layout.slice(buttonStartIndex, buttonEndIndex);

    expect(layout).toContain("import { Button } from '@lostgradient/cinder/button';");
    expect(mobileMenuButton).toContain('iconOnly');
    expect(mobileMenuButton).toContain('label="Open navigation menu"');
    expect(mobileMenuButton).toContain('aria-controls="app-sidebar"');
    expect(mobileMenuButton).toContain('aria-expanded={!collapsed}');
    expect(layout).not.toContain('mobile-menu-button');
    expect(layout).toMatch(/<Sidebar[\s\S]*id="app-sidebar"/);
  });
});
