<script lang="ts">
  import type { LayoutProps } from './$types';
  import { page } from '$app/state';
  import { MediaQuery } from 'svelte/reactivity';
  import { Button } from '@lostgradient/cinder/button';
  import { SIDEBAR_MOBILE_MEDIA_QUERY, Sidebar } from '@lostgradient/cinder/sidebar';
  import { SideNavigation } from '@lostgradient/cinder/side-navigation';
  import { StatusDot } from '@lostgradient/cinder/status-dot';
  import SkipLinks from '$lib/components/skip-links.svelte';
  import UserMenu from '$lib/components/user-menu.svelte';
  import FolderGit2 from 'lucide-svelte/icons/folder-git-2';
  import Bot from 'lucide-svelte/icons/bot';
  import Activity from 'lucide-svelte/icons/activity';
  import CircleDollarSign from 'lucide-svelte/icons/circle-dollar-sign';
  import SettingsIcon from 'lucide-svelte/icons/settings';
  import Workflow from 'lucide-svelte/icons/workflow';
  import Menu from 'lucide-svelte/icons/menu';
  import WebhookIcon from 'lucide-svelte/icons/webhook';

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
  const webhooksActive = $derived(
    page.url.pathname === '/webhooks' || page.url.pathname.startsWith('/webhooks/'),
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
  const isNarrowViewport = new MediaQuery(SIDEBAR_MOBILE_MEDIA_QUERY, false);
  const mobileLayoutStyles = `
    #authenticated-shell {
      flex-direction: column;
    }

    #authenticated-shell > .mobile-topbar {
      display: flex;
    }

    #authenticated-shell > .desktop-sidebar-shell {
      display: contents;
    }

    #authenticated-shell .desktop-brand-link {
      display: none;
    }

    #authenticated-shell .app-sidebar {
      inline-size: auto;
    }
  `;
  let collapsed = $state(isNarrowViewport.current);
  let lastNarrow = isNarrowViewport.current;
  $effect(() => {
    if (isNarrowViewport.current !== lastNarrow) {
      lastNarrow = isNarrowViewport.current;
      collapsed = isNarrowViewport.current;
    }
  });
</script>

<svelte:head>
  <svelte:element this={'style'} media={SIDEBAR_MOBILE_MEDIA_QUERY}
    >{mobileLayoutStyles}</svelte:element
  >
</svelte:head>

<SkipLinks />

<div id="authenticated-shell" class="app-layout">
  <!--
    Mobile top bar: shown only on narrow viewports where the Sidebar renders as
    a Drawer overlay. The hamburger button opens the drawer by setting
    collapsed=false; the Drawer's built-in close button sets it back to true.
  -->
  <div class="mobile-topbar" data-theme="dark">
    <Button
      variant="ghost"
      size="md"
      iconOnly
      label="Open navigation menu"
      onclick={() => (collapsed = false)}
      aria-controls="app-sidebar"
      aria-expanded={!collapsed}
    >
      <Menu size={20} aria-hidden="true" />
    </Button>
    <a href="/repositories" class="mobile-brand-link">
      <span class="mobile-brand-name">Tribunal</span>
    </a>
  </div>

  <!--
    Sidebar: renders as an <aside> on desktop and as a <Drawer> on mobile
    (breakpoint handled inside the Cinder Sidebar component via MediaQuery).
    data-theme="dark" is forwarded via rest props to the underlying element.
  -->
  <div class="desktop-sidebar-shell" data-theme="dark" data-collapsed={collapsed}>
    <a href="/repositories" class="brand-link desktop-brand-link">
      <span class="brand-name">Tribunal</span>
    </a>

    <Sidebar id="app-sidebar" bind:collapsed label="Tribunal" class="app-sidebar" data-theme="dark">
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
          <SideNavigation.Item href="/webhooks" active={webhooksActive}>
            <WebhookIcon size={16} aria-hidden="true" />
            Webhooks
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
            <StatusDot
              status={data.reviewsEnabled ? 'success' : 'neutral'}
              label={data.reviewsEnabled ? 'Reviews active' : 'Reviews paused'}
              showLabel={false}
              size="sm"
            />
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
  </div>

  <main id="main-content">
    {@render children()}
  </main>
</div>

<style>
  .desktop-sidebar-shell {
    display: flex;
    flex-direction: column;
    inline-size: 13.5rem;
    flex-shrink: 0;
    min-block-size: 0;
    background: var(--cinder-surface);
    border-inline-end: 1px solid var(--cinder-border);
  }

  .desktop-sidebar-shell[data-collapsed='true'] {
    inline-size: 4rem;
  }

  .app-layout :global(.app-sidebar) {
    inline-size: 100%;
    flex: 1 1 0;
    min-block-size: 0;
    border-inline-end: 0;
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
   * Mobile top bar
   * ============================================================ */

  .mobile-topbar {
    display: none;
    align-items: center;
    gap: var(--space-3);
    padding-block: var(--space-3);
    padding-inline: var(--space-4);
    /* Explicit dark surface that matches the app navigation. */
    background: oklch(20% 0.04 245);
    border-bottom: 1px solid oklch(40% 0.05 245);
    flex-shrink: 0;
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

  .desktop-brand-link {
    padding-block: var(--cinder-space-4);
    padding-inline: var(--cinder-space-4);
    border-block-end: 1px solid var(--cinder-border);
    flex-shrink: 0;
    overflow: hidden;
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
    color: var(--cinder-text-muted);
    font-size: var(--text-xs);
  }

  .status-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .brand-link:hover {
    opacity: 0.8;
  }

  .status-text {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--cinder-text);
  }
</style>
