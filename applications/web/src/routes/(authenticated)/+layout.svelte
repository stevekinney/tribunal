<script lang="ts">
  import { onMount } from 'svelte';
  import { Navigation, NavigationItem } from '@tribunal/components/navigation';
  import { SkipLinks } from '@tribunal/components/skip-links';
  import { Avatar } from '@tribunal/components/avatar';
  import { UserMenu } from '@tribunal/components/user-menu';
  import { LogOut, FolderGit2, Cat } from 'lucide-svelte';

  let { data, children } = $props();

  let hydrated = $state(false);

  onMount(() => {
    hydrated = true;
  });
</script>

<SkipLinks />

<div class="app-layout" data-ready={hydrated && data.user ? true : undefined}>
  <header class="app-header" data-theme="dark">
    <div class="header-content">
      <Navigation>
        {#snippet start()}
          <a href="/repositories" class="brand-link">
            <div class="brand-icon">
              <Cat class="brand-logo" />
            </div>
            <span class="brand-name">Tribunal</span>
          </a>
        {/snippet}

        <NavigationItem href="/repositories">Repositories</NavigationItem>

        {#snippet end()}
          {#if data.user}
            <UserMenu id="header-user-menu" user={data.user} />
          {/if}
        {/snippet}

        {#snippet drawer()}
          <NavigationItem href="/repositories" layout="vertical">
            <FolderGit2 class="icon-md" aria-hidden="true" />
            Repositories
          </NavigationItem>

          <div class="drawer-footer">
            {#if data.user}
              <div class="drawer-user">
                <Avatar src={data.user.avatarUrl} alt={data.user.username} />
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
        {/snippet}
      </Navigation>
    </div>
  </header>

  <main id="main-content">
    {@render children()}
  </main>
</div>

<style>
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
