<script lang="ts">
  import type { LayoutProps } from './$types';
  import { page } from '$app/state';
  import { MediaQuery } from 'svelte/reactivity';
  import { Sidebar } from '@lostgradient/cinder/sidebar';
  import { SideNavigation } from '@lostgradient/cinder/side-navigation';
  import SkipLinks from '$lib/components/skip-links.svelte';
  import UserMenu from '$lib/components/user-menu.svelte';
  import FolderGit2 from 'lucide-svelte/icons/folder-git-2';
  import Bot from 'lucide-svelte/icons/bot';
  import Activity from 'lucide-svelte/icons/activity';
  import CircleDollarSign from 'lucide-svelte/icons/circle-dollar-sign';
  import SettingsIcon from 'lucide-svelte/icons/settings';
  import Workflow from 'lucide-svelte/icons/workflow';
  import Menu from 'lucide-svelte/icons/menu';

  let { data, children }: LayoutProps = $props();

  // NavigationItem owns the active styling; the app owns the routing match.
  const repositoriesActive = $derived(
    page.url.pathname === '/repositories' || page.url.pathname.startsWith('/repositories/'),
  );
  const agentsActive = $derived(
    page.url.pathname === '/agents' || page.url.pathname.startsWith('/agents/'),
  );
  const runsActive = $derived(
    page.url.pathname === '/runs' || page.url.pathname.startsWith('/runs/'),
  );
  const costsActive = $derived(page.url.pathname === '/costs');
  const settingsActive = $derived(page.url.pathname === '/settings');
  const workflowInspectorActive = $derived(page.url.pathname === '/workflow-inspector');

  // Sidebar collapsed state drives both the desktop icon-only mode and the
  // mobile drawer open/closed state (collapsed=true → drawer closed). It is
  // bindable (the drawer's close button writes it) and defaults to the viewport:
  // collapsed on narrow screens, expanded on wide. MediaQuery (SSR fallback false
  // → desktop default) keeps it reactive across resizes; we re-sync only when the
  // breakpoint is actually crossed so a manual toggle within a breakpoint sticks.
  const isNarrowViewport = new MediaQuery('(max-width: 47.99rem)');
  let collapsed = $state(isNarrowViewport.current);
  let lastNarrow = isNarrowViewport.current;
  $effect(() => {
    if (isNarrowViewport.current !== lastNarrow) {
      lastNarrow = isNarrowViewport.current;
      collapsed = isNarrowViewport.current;
    }
  });
</script>

<SkipLinks />

<div class="app-layout">
  <!--
    Mobile top bar: shown only on narrow viewports where the Sidebar renders as
    a Drawer overlay. The hamburger button opens the drawer by setting
    collapsed=false; the Drawer's built-in close button sets it back to true.
  -->
  <div class="mobile-topbar">
    <button
      class="mobile-menu-button"
      onclick={() => (collapsed = false)}
      aria-label="Open navigation menu"
      aria-expanded={!collapsed}
    >
      <Menu size={20} aria-hidden="true" />
    </button>
    <a href="/repositories" class="mobile-brand-link">
      <span class="mobile-brand-name">Tribunal</span>
    </a>
  </div>

  <!--
    Sidebar: renders as an <aside> on desktop and as a <Drawer> on mobile
    (breakpoint handled inside the Cinder Sidebar component via MediaQuery).
    data-theme="dark" is forwarded via rest props to the underlying element.
  -->
  <Sidebar bind:collapsed label="Tribunal" data-theme="dark">
    {#snippet brand()}
      <a href="/repositories" class="brand-link">
        <span class="brand-name">Tribunal</span>
      </a>
    {/snippet}

    {#snippet navigation()}
      <SideNavigation ariaLabel="Tribunal navigation">
        <SideNavigation.Item href="/repositories" active={repositoriesActive}>
          <FolderGit2 size={16} aria-hidden="true" />
          Repositories
        </SideNavigation.Item>
        <SideNavigation.Item href="/agents" active={agentsActive}>
          <Bot size={16} aria-hidden="true" />
          Agents
        </SideNavigation.Item>
        <SideNavigation.Item href="/runs" active={runsActive}>
          <Activity size={16} aria-hidden="true" />
          Runs
        </SideNavigation.Item>
        <SideNavigation.Item href="/costs" active={costsActive}>
          <CircleDollarSign size={16} aria-hidden="true" />
          Costs
        </SideNavigation.Item>
        <SideNavigation.Item href="/settings" active={settingsActive}>
          <SettingsIcon size={16} aria-hidden="true" />
          Settings
        </SideNavigation.Item>
        {#if data.user?.isPlatformAdministrator}
          <SideNavigation.Item href="/workflow-inspector" active={workflowInspectorActive}>
            <Workflow size={16} aria-hidden="true" />
            Workflows
          </SideNavigation.Item>
        {/if}
      </SideNavigation>
    {/snippet}

    {#snippet footer()}
      <div class="footer-content">
        <div class={['reviews-status', { paused: !data.reviewsEnabled }]}>
          <span class="status-dot" aria-hidden="true"></span>
          <span class="status-text"
            >{data.reviewsEnabled ? 'Reviews active' : 'Reviews paused'}</span
          >
        </div>
        {#if data.user}
          <UserMenu id="sidebar-user-menu" user={data.user} menuPlacement="sidebar-footer" />
        {/if}
      </div>
    {/snippet}
  </Sidebar>

  <main id="main-content">
    {@render children()}
  </main>
</div>

<style>
  /*
   * Cinder tokens use light-dark() and inherit their computed value from :root
   * (color-scheme: light), ignoring color-scheme: dark on this subtree.
   * Verified in DevTools: removing these overrides produces dark-on-dark text.
   *
   * The surface and border tokens are also overridden explicitly so the dark
   * background is reliable regardless of browser light-dark() re-evaluation
   * behaviour on the dark subtree.
   *
   * Desktop: the <aside> receives data-theme="dark" directly.
   * Mobile: the <Drawer dialog> receives data-theme="dark" via rest props; the
   * inner .cinder-sidebar--mobile is a descendant, so [data-theme='dark'] .cinder-sidebar
   * catches it.
   */
  :global(.cinder-sidebar[data-theme='dark']),
  :global([data-theme='dark'] .cinder-sidebar) {
    --cinder-text: oklch(92% 0.02 245);
    --cinder-text-muted: oklch(82% 0.02 245);
    /* App tokens consumed by the footer .reviews-status pill/dot. Same
     * light-dark() non-re-resolution applies, so pin their dark arms here or the
     * status dot resolves to a mid-lightness light arm and falls below 3:1 on
     * the dark surface (WCAG 1.4.11). Values match tokens.css dark arms. */
    --success: oklch(78% 0.14 145);
    --text-subtle: oklch(72% 0.02 245);
  }

  /* Only the desktop aside needs explicit surface/border overrides. The mobile
   * .cinder-sidebar--mobile is background: transparent (Drawer owns the surface). */
  :global(.cinder-sidebar[data-theme='dark']:not(.cinder-sidebar--mobile)) {
    --cinder-surface: oklch(20% 0.04 245);
    --cinder-border: oklch(40% 0.05 245);
    inline-size: 13.5rem;
  }

  /*
   * Mobile drawer panel background. The Drawer renders:
   *   <dialog data-theme="dark" class="cinder-drawer">
   *     <div class="cinder-drawer__panel">  ← uses --cinder-surface-raised
   * Setting the token on the dialog propagates via inheritance.
   */
  :global(.cinder-drawer[data-theme='dark']) {
    --cinder-surface-raised: oklch(26% 0.045 245);
    --cinder-border: oklch(40% 0.05 245);
  }

  /* ============================================================
   * Page shell
   * ============================================================ */

  /*
   * The outer shell is exactly 100vh tall with overflow hidden so the page
   * itself never scrolls. The sidebar stays pinned at viewport height; the
   * main area scrolls independently. This is more reliable than position:sticky
   * on the sidebar (which can be silently defeated by ancestor overflow).
   */
  .app-layout {
    display: flex;
    flex-direction: row;
    height: 100vh;
    overflow: hidden;
    background: var(--surface);
  }

  #main-content {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-width: 0;
    overflow-y: auto;
  }

  /* ============================================================
   * Mobile top bar (shown below the sidebar's own 47.99rem breakpoint)
   * ============================================================ */

  .mobile-topbar {
    display: none;
  }

  @media (max-width: 47.99rem) {
    /* On narrow viewports the Sidebar renders as a Drawer overlay.
     * Flip the page shell to a column and show the top bar.
     * height: 100vh + overflow: hidden carry over — topbar at top, main scrolls. */
    .app-layout {
      flex-direction: column;
    }

    .mobile-topbar {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding-block: var(--space-3);
      padding-inline: var(--space-4);
      /* Explicit dark surface — same reasoning as .cinder-sidebar overrides above */
      background: oklch(20% 0.04 245);
      border-bottom: 1px solid oklch(40% 0.05 245);
      flex-shrink: 0;
    }

    /*
     * SSR flash guard: on the first server-rendered paint the Sidebar component
     * renders as a desktop <aside> because its MediaQuery fallback is false.
     * Hide the aside on narrow viewports so it does not appear briefly as a
     * 256px block above main before hydration switches it to a Drawer.
     */
    :global(.cinder-sidebar:not(.cinder-sidebar--mobile)) {
      display: none;
    }
  }

  .mobile-menu-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: oklch(92% 0.02 245);
    cursor: pointer;
    transition: background var(--duration) var(--ease-standard);
  }

  .mobile-menu-button:hover {
    background: oklch(92% 0.02 245 / 12%);
  }

  .brand-link {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }

  .brand-name {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--cinder-text);
  }

  .footer-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }

  .reviews-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    min-width: 0;
    color: var(--text-subtle);
    font-size: var(--text-xs);
  }

  .status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: var(--success);
    flex: none;
  }

  .reviews-status.paused .status-dot {
    background: var(--text-subtle);
  }

  .status-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobile-menu-button:focus-visible {
    outline: var(--ring-width) solid oklch(72% 0.14 270);
    outline-offset: var(--ring-offset);
  }

  .mobile-brand-link {
    display: flex;
    align-items: center;
    text-decoration: none;
  }

  .mobile-brand-name {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: oklch(92% 0.02 245);
  }

  /* ============================================================
   * Sidebar brand region
   * ============================================================ */

  .brand-link:hover {
    opacity: 0.8;
  }

  /* ============================================================
   * Footer: status pill + user menu
   * ============================================================ */

  .reviews-status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in oklch, var(--success), transparent 85%);
  }

  .reviews-status.paused {
    background: color-mix(in oklch, var(--text-subtle), transparent 88%);
  }

  .status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: var(--radius-full);
    background: var(--success);
    flex-shrink: 0;
  }

  .reviews-status.paused .status-dot {
    background: var(--text-subtle);
  }

  .status-text {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--cinder-text);
  }
</style>
