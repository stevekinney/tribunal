<script lang="ts">
  import { page } from '$app/state';
  import { NavigationBar } from '@lostgradient/cinder/navigation-bar';
  import type { NavigationBarToggleAttributes } from '@lostgradient/cinder/navigation-bar';
  import { NavigationItem } from '@lostgradient/cinder/navigation-item';
  import { Avatar } from '@lostgradient/cinder/avatar';
  import SkipLinks from '$lib/components/skip-links.svelte';
  import UserMenu from '$lib/components/user-menu.svelte';
  import {
    LogOut,
    FolderGit2,
    Cat,
    Menu,
    X,
    Bot,
    Activity,
    CircleDollarSign,
    Settings,
    Workflow,
  } from 'lucide-svelte';

  let { data, children } = $props();

  let mobileMenuOpen = $state(false);

  // NavigationItem owns the active styling; the app owns the routing match.
  const repositoriesActive = $derived(
    page.url.pathname === '/repositories' || page.url.pathname.startsWith('/repositories/'),
  );
  const agentsActive = $derived(page.url.pathname === '/agents');
  const runsActive = $derived(
    page.url.pathname === '/runs' || page.url.pathname.startsWith('/runs/'),
  );
  const costsActive = $derived(page.url.pathname === '/costs');
  const settingsActive = $derived(page.url.pathname === '/settings');
  const workflowInspectorActive = $derived(page.url.pathname === '/workflow-inspector');
</script>

<SkipLinks />

<div class="app-layout">
  <header class="app-header" data-theme="dark">
    <div class="header-content">
      <NavigationBar bind:mobileMenuOpen>
        {#snippet brand()}
          <a href="/repositories" class="brand-link">
            <div class="brand-icon">
              <Cat class="brand-logo" />
            </div>
            <span class="brand-name">Tribunal</span>
          </a>
        {/snippet}

        {#snippet items({ variant })}
          {#if variant === 'mobile'}
            <NavigationItem href="/repositories" variant="vertical" active={repositoriesActive}>
              <FolderGit2 class="icon-md" aria-hidden="true" />
              Repositories
            </NavigationItem>
            <NavigationItem href="/agents" variant="vertical" active={agentsActive}>
              <Bot class="icon-md" aria-hidden="true" />
              Agents
            </NavigationItem>
            <NavigationItem href="/runs" variant="vertical" active={runsActive}>
              <Activity class="icon-md" aria-hidden="true" />
              Runs
            </NavigationItem>
            <NavigationItem href="/costs" variant="vertical" active={costsActive}>
              <CircleDollarSign class="icon-md" aria-hidden="true" />
              Costs
            </NavigationItem>
            <NavigationItem href="/settings" variant="vertical" active={settingsActive}>
              <Settings class="icon-md" aria-hidden="true" />
              Settings
            </NavigationItem>
            {#if data.user?.isPlatformAdministrator}
              <NavigationItem
                href="/workflow-inspector"
                variant="vertical"
                active={workflowInspectorActive}
              >
                <Workflow class="icon-md" aria-hidden="true" />
                Workflows
              </NavigationItem>
            {/if}

            <div class="drawer-footer">
              {#if data.user}
                <div class="drawer-user">
                  <Avatar src={data.user.avatarUrl ?? undefined} alt={data.user.username} />
                  <div class="drawer-user-info">
                    <span class="drawer-username">{data.user.username}</span>
                  </div>
                </div>
              {/if}
              <form method="POST" action="/logout">
                <button type="submit" class="sign-out-button">
                  <LogOut class="sign-out-icon" />
                  Sign out
                </button>
              </form>
            </div>
          {:else}
            <NavigationItem href="/repositories" active={repositoriesActive}>
              Repositories
            </NavigationItem>
            <NavigationItem href="/agents" active={agentsActive}>Agents</NavigationItem>
            <NavigationItem href="/runs" active={runsActive}>Runs</NavigationItem>
            <NavigationItem href="/costs" active={costsActive}>Costs</NavigationItem>
            <NavigationItem href="/settings" active={settingsActive}>Settings</NavigationItem>
            {#if data.user?.isPlatformAdministrator}
              <NavigationItem href="/workflow-inspector" active={workflowInspectorActive}>
                Workflows
              </NavigationItem>
            {/if}
          {/if}
        {/snippet}

        {#snippet menuToggle(attrs: NavigationBarToggleAttributes)}
          <button type="button" {...attrs} aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}>
            {#if mobileMenuOpen}
              <X aria-hidden="true" />
            {:else}
              <Menu aria-hidden="true" />
            {/if}
          </button>
        {/snippet}

        {#snippet actions()}
          {#if data.user}
            <UserMenu id="header-user-menu" user={data.user} />
          {/if}
        {/snippet}
      </NavigationBar>
    </div>
  </header>

  <main id="main-content">
    {@render children()}
  </main>
</div>

<style>
  /*
   * Dark-header nav text colors.
   *
   * The header is themed dark via `data-theme="dark"`, but Cinder's
   * NavigationItem resolves its `light-dark()` color tokens against the root
   * color-scheme (light), not this nested dark subtree — so labels render
   * dark-on-dark and disappear.
   *
   * Overriding the Cinder CSS custom properties at this scope is the correct
   * fix: they cascade through the subtree and survive any Cinder class rename.
   * Tribunal's `--text`/`--text-muted` do resolve correctly against a
   * `data-theme` element, keeping the colors themeable rather than hard-coded.
   */
  .app-header[data-theme='dark'] {
    --cinder-text-muted: var(--text-muted);
    --cinder-text: var(--text);
  }

  .app-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: var(--surface);
  }

  #main-content {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
  }

  .app-header {
    border-bottom: 1px solid var(--border-muted);
    background: var(--surface);
  }

  .header-content {
    max-width: 72rem;
    margin-inline: auto;
    padding-inline: var(--space-4);
  }

  @media (min-width: 640px) {
    .header-content {
      padding-inline: var(--space-6);
    }
  }

  .brand-link {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    transition: opacity var(--duration) var(--ease-standard);
  }

  .brand-link:hover {
    opacity: 0.8;
  }

  .brand-icon {
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-lg);
    background: linear-gradient(
      to bottom right,
      var(--secondary),
      oklch(from var(--secondary) calc(l - 0.12) c h)
    );
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :global(.brand-logo) {
    width: 1.5rem;
    height: 1.5rem;
    color: white;
  }

  .brand-name {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--text);
  }

  .drawer-footer {
    margin-top: auto;
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }

  .drawer-user {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }

  .drawer-user-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .drawer-username {
    font-weight: var(--font-medium);
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sign-out-button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 3rem;
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--text-muted);
    border-radius: var(--radius-lg);
    transition:
      background-color var(--duration) var(--ease-standard),
      color var(--duration) var(--ease-standard);
  }

  .sign-out-button:hover {
    background: color-mix(in oklch, var(--danger), transparent 90%);
    color: var(--danger);
  }

  :global(.sign-out-icon) {
    width: 1.25rem;
    height: 1.25rem;
  }
</style>
