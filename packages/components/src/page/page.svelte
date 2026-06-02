<script lang="ts" module>
  import type { Snippet } from 'svelte';

  import type { Tab } from './create-tabs';
  import type { BreadcrumbItem } from '../breadcrumbs';

  export type PageProps = {
    /** Page title - used in header and <title> tag */
    title: string;
    /** Meta description for SEO */
    description?: string;
    /** Optional subtitle shown below the title in the header */
    subtitle?: string;
    /** Icon component to show before title (Lucide icon or similar) */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon?: any;
    /** Actions (buttons, etc.) to show on the right side of the header */
    actions?: Snippet;
    /** Navigation tabs to show below the header */
    tabs?: Tab[];
    /** Breadcrumb navigation items to show above the title */
    breadcrumbs?: BreadcrumbItem[];
    /** Override preload-data behavior for tab links */
    tabPreloadData?: 'hover' | 'tap' | 'off';
    /** Override preload-code behavior for tab links */
    tabPreloadCode?: 'hover' | 'viewport' | 'eager' | 'off';
    /** Page content */
    children: Snippet;
  };
</script>

<script lang="ts">
  import IconContainer from '../icon-container/icon-container.svelte';
  import { Breadcrumbs } from '../breadcrumbs';

  let {
    title,
    description,
    subtitle,
    icon,
    actions,
    tabs = [],
    breadcrumbs,
    tabPreloadData,
    tabPreloadCode,
    children,
  }: PageProps = $props();

  const pageTitle = $derived(title ? `${title} | Tribunal` : 'Tribunal');
</script>

<svelte:head>
  <title>{pageTitle}</title>
  {#if description}
    <meta name="description" content={description} />
    <meta property="og:description" content={description} />
  {/if}
  <meta property="og:title" content={title} />
</svelte:head>

<!-- Page Header (inlined) -->
<header class="page-header">
  <div class="page-header-container">
    {#if breadcrumbs && breadcrumbs.length > 0}
      <Breadcrumbs items={breadcrumbs} class="page-breadcrumbs" />
    {/if}
    <div class="page-header-row">
      <div class="page-header-leading">
        {#if icon}
          <IconContainer {icon} variant="outlined" />
        {/if}
        <div class="page-header-title-group">
          <h1 class="page-header-title">{title}</h1>
          {#if subtitle}
            <p class="page-header-subtitle">{subtitle}</p>
          {/if}
        </div>
      </div>

      {#if actions}
        {@render actions()}
      {/if}
    </div>
  </div>
</header>

{#if tabs.length > 0}
  <div class="tabs-bar">
    <nav
      class="tabs-content"
      aria-label="Section navigation"
      data-sveltekit-preload-data={tabPreloadData}
      data-sveltekit-preload-code={tabPreloadCode}
    >
      <div class="tabs-list">
        {#each tabs as tab (tab.path)}
          <a
            href={tab.path}
            aria-current={tab.active ? 'page' : undefined}
            class="tab"
            data-active={tab.active}
          >
            {tab.label}
          </a>
        {/each}
      </div>
    </nav>
  </div>
{/if}

<main class="page-content">
  {@render children()}
</main>

<style>
  /* Page Header styles */
  .page-header {
    position: sticky;
    top: 0;
    z-index: 10;
    border-bottom: 1px solid var(--border-muted);
    padding-block: var(--space-3);
    background: color-mix(in oklch, var(--surface), transparent 20%);
    backdrop-filter: blur(24px);
  }

  .page-header-container {
    max-width: 72rem;
    margin-inline: auto;
    padding-inline: var(--space-4);
  }

  @media (min-width: 640px) {
    .page-header-container {
      padding-inline: var(--space-6);
    }
  }

  .page-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .page-header-leading {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .page-header-title-group {
    min-width: 0;
  }

  .page-header-title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--text);
  }

  .page-header-subtitle {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin-top: 0.125rem;
  }

  :global(.page-breadcrumbs) {
    margin-bottom: var(--space-2);
  }

  /* Page Content styles */
  .page-content {
    flex: 1 1 0;
    min-height: 0;
    width: 100%;
    max-width: 72rem;
    margin-inline: auto;
    padding-inline: var(--space-4);
    padding-block: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .tabs-bar {
    border-bottom: 1px solid var(--border-muted);
  }

  .tabs-content {
    max-width: 72rem;
    margin-inline: auto;
    padding-inline: var(--space-4);
  }

  .tabs-list {
    display: flex;
    gap: var(--space-1);
    margin-bottom: -1px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-inline: var(--space-2);
    padding-block: var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-bottom: 2px solid transparent;
    text-decoration: none;
    transition:
      color var(--duration-fast) var(--ease-standard),
      border-color var(--duration-fast) var(--ease-standard);
  }

  .tab[data-active='true'] {
    border-bottom-color: var(--accent);
    color: var(--accent);
  }

  .tab[data-active='false'] {
    color: var(--text-muted);
  }

  .tab[data-active='false']:hover {
    color: var(--text);
    border-bottom-color: var(--border-strong);
  }

  @media (min-width: 640px) {
    .tabs-content {
      padding-inline: var(--space-6);
    }

    .page-content {
      padding-inline: var(--space-6);
    }
  }
</style>
