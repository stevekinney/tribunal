import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(resolve(directory, './+layout.svelte'), 'utf-8');
const removedBrandSnippet = ['{#snippet ', 'brand', '()}'].join('');

describe('authenticated layout sidebar styles', () => {
  it('owns authenticated shell branding outside the Cinder Sidebar brand snippet', () => {
    const sidebarStartIndex = layout.indexOf('<Sidebar');
    const sidebarEndIndex = layout.indexOf('</Sidebar>') + '</Sidebar>'.length;
    const sidebarInvocation = layout.slice(sidebarStartIndex, sidebarEndIndex);
    const desktopShellStartIndex = layout.indexOf('<div class="desktop-sidebar-shell"');
    const desktopShellEndIndex = layout.indexOf('<Sidebar', desktopShellStartIndex);
    const desktopShellBrand = layout.slice(desktopShellStartIndex, desktopShellEndIndex);

    expect(layout).not.toContain(removedBrandSnippet);
    expect(sidebarInvocation).not.toContain('brand');
    expect(desktopShellBrand).toContain('href="/repositories"');
    expect(desktopShellBrand).toContain('class="brand-link desktop-brand-link"');
    expect(desktopShellBrand).toContain('<span class="brand-name">Tribunal</span>');
    expect(layout).toContain('class="mobile-brand-link"');
    expect(layout).toContain('<span class="mobile-brand-name">Tribunal</span>');
  });

  it("uses Cinder's public mobile media query contract for layout state", () => {
    const head = layout.slice(layout.indexOf('<svelte:head>'), layout.indexOf('</svelte:head>'));

    expect(layout).toMatch(/new MediaQuery\(\s*SIDEBAR_MOBILE_MEDIA_QUERY,\s*false\s*\)/);
    expect(head).toContain('<svelte:element');
    expect(head).toContain('media={SIDEBAR_MOBILE_MEDIA_QUERY}');
    expect(layout).not.toContain('47.99rem');
    expect(layout).not.toContain('48rem');
    expect(layout).not.toContain('cinder-sidebar--mobile');
  });

  it('keeps the app-owned desktop brand aligned with expanded and collapsed sidebar widths', () => {
    expect(layout).toContain('class="desktop-sidebar-shell"');
    expect(layout).toContain('data-collapsed={collapsed}');
    expect(layout).toContain(".desktop-sidebar-shell[data-collapsed='true']");
    expect(layout).toMatch(/\.desktop-sidebar-shell\s*\{[\s\S]*inline-size: 13\.5rem;/);
    expect(layout).toMatch(
      /\.desktop-sidebar-shell\[data-collapsed='true'\]\s*\{[\s\S]*inline-size: 4rem;/,
    );
    expect(layout).toMatch(/#authenticated-shell \.desktop-brand-link\s*\{[\s\S]*display: none;/);
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
