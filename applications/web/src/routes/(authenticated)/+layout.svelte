<script lang="ts">
  import type { LayoutProps } from './$types';
  import { page } from '$app/state';
  import { NavigationBar } from '@lostgradient/cinder/navigation-bar';
  import { NavigationItem } from '@lostgradient/cinder/navigation-item';
  import SkipLinks from '$lib/components/skip-links.svelte';
  import UserMenu from '$lib/components/user-menu.svelte';
  import { Cat } from 'lucide-svelte';

  let { data, children }: LayoutProps = $props();

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
      <NavigationBar>
        {#snippet brand()}
          <a href="/repositories" class="brand-link">
            <div class="brand-icon">
              <Cat class="brand-logo" />
            </div>
            <span class="brand-name">Tribunal</span>
          </a>
        {/snippet}

        {#snippet items({ variant })}
          <NavigationItem
            href="/repositories"
            variant={variant === 'mobile' ? 'vertical' : 'horizontal'}
            active={repositoriesActive}
          >
            Repositories
          </NavigationItem>
          <NavigationItem
            href="/agents"
            variant={variant === 'mobile' ? 'vertical' : 'horizontal'}
            active={agentsActive}
          >
            Agents
          </NavigationItem>
          <NavigationItem
            href="/runs"
            variant={variant === 'mobile' ? 'vertical' : 'horizontal'}
            active={runsActive}
          >
            Runs
          </NavigationItem>
          <NavigationItem
            href="/costs"
            variant={variant === 'mobile' ? 'vertical' : 'horizontal'}
            active={costsActive}
          >
            Costs
          </NavigationItem>
          <NavigationItem
            href="/settings"
            variant={variant === 'mobile' ? 'vertical' : 'horizontal'}
            active={settingsActive}
          >
            Settings
          </NavigationItem>
          {#if data.user?.isPlatformAdministrator}
            <NavigationItem
              href="/workflow-inspector"
              variant={variant === 'mobile' ? 'vertical' : 'horizontal'}
              active={workflowInspectorActive}
            >
              Workflows
            </NavigationItem>
          {/if}
        {/snippet}

        {#snippet actions()}
          {#if data.user}
            <UserMenu id="header-user-menu" user={data.user} />
          {/if}
        {/snippet}
      </NavigationBar>
      <nav id="mobile-navigation" class="mobile-navigation" aria-label="Mobile navigation">
        <NavigationItem href="/repositories" variant="vertical" active={repositoriesActive}>
          Repositories
        </NavigationItem>
        <NavigationItem href="/agents" variant="vertical" active={agentsActive}>
          Agents
        </NavigationItem>
        <NavigationItem href="/runs" variant="vertical" active={runsActive}>Runs</NavigationItem>
        <NavigationItem href="/costs" variant="vertical" active={costsActive}>Costs</NavigationItem>
        <NavigationItem href="/settings" variant="vertical" active={settingsActive}>
          Settings
        </NavigationItem>
        {#if data.user?.isPlatformAdministrator}
          <NavigationItem
            href="/workflow-inspector"
            variant="vertical"
            active={workflowInspectorActive}
          >
            Workflows
          </NavigationItem>
        {/if}
      </nav>
    </div>
  </header>

  <main id="main-content">
    {@render children()}
  </main>
</div>

<style>
  /* light-dark() custom properties inherit the resolved value from :root
     (color-scheme: light), ignoring color-scheme: dark on this subtree.
     Verified in DevTools: removing these overrides produces dark-on-dark text. */
  .app-header[data-theme='dark'] {
    --cinder-text-muted: oklch(82% 0.02 245);
    --cinder-text: oklch(92% 0.02 245);
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

  .mobile-navigation {
    display: none;
    padding-block: var(--space-2);
    border-top: 1px solid color-mix(in oklch, var(--border-muted), transparent 35%);
  }

  @media (max-width: 767px) {
    :global(.cinder-navigation-bar__items) {
      display: none;
    }

    .mobile-navigation {
      display: grid;
      gap: var(--space-1);
    }
  }
</style>
