<script lang="ts" module>
  import type { Snippet, Component } from 'svelte';
  import type { BreadcrumbItem } from '@lostgradient/cinder/breadcrumbs';

  export type { BreadcrumbItem };

  export type PageProps = {
    /** Page title — used in the h1 header and in the browser <title> tag. */
    title: string;
    /** Meta description for SEO only. Never rendered visibly on the page. */
    description?: string;
    /** Visible supporting line rendered beneath the h1. */
    subtitle?: string;
    /** Lucide icon component rendered beside the heading. */
    icon?: Component;
    /** Actions snippet rendered on the right side of the header row. */
    actions?: Snippet;
    /** Breadcrumb navigation items shown above the heading. */
    breadcrumbs?: BreadcrumbItem[];
    /** Page content. */
    children: Snippet;
  };
</script>

<script lang="ts">
  import { Breadcrumbs } from '@lostgradient/cinder/breadcrumbs';

  let {
    title,
    description,
    subtitle,
    icon: Icon,
    actions,
    breadcrumbs,
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

<header class="page-header">
  <div class="page-header-container">
    {#if breadcrumbs && breadcrumbs.length > 0}
      <Breadcrumbs items={breadcrumbs} class="page-breadcrumbs" />
    {/if}
    <div class="page-header-row">
      <div class="page-header-leading">
        {#if Icon}
          <div class="page-icon-container">
            <Icon class="page-icon" />
          </div>
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

<div class="page-content">
  {@render children()}
</div>

<style>
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

  .page-icon-container {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: var(--radius-lg);
    width: 2.5rem;
    height: 2.5rem;
    background: var(--surface-overlay);
    box-shadow: inset 0 0 0 1px var(--border);
    color: var(--text-muted);
  }

  :global(.page-icon) {
    width: 1.25rem;
    height: 1.25rem;
  }

  .page-content {
    flex: 1 1 0;
    width: 100%;
    max-width: 72rem;
    margin-inline: auto;
    padding-inline: var(--space-4);
    padding-block: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  @media (min-width: 640px) {
    .page-content {
      padding-inline: var(--space-6);
    }
  }
</style>
