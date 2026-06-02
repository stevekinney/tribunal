<script lang="ts">
  import './layout.css';

  let { children } = $props();

  const description = 'GitHub repository management and pull request insights';
</script>

<svelte:head>
  <title>Tribunal</title>
  <meta name="description" content={description} />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Tribunal" />
  <meta property="og:title" content="Tribunal" />
  <meta property="og:description" content={description} />
  <meta property="og:image" content="/hydraphonic.webp" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Tribunal" />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content="/hydraphonic.webp" />

  <link rel="icon" href="https://fav.farm/🔭" />
</svelte:head>

{@render children()}
