<!--
  Required alongside +page.server.ts for its `actions` to exist -- SvelteKit
  form actions are always associated with a page route. This page itself is
  not the sign-out trigger: user-menu.svelte's hidden form (submitted via
  `use:enhance`, which runs the cross-tab broadcast and Neon Auth sign-out
  before this action's POST) is. This page only actually renders in the
  no-JS fallback (a full navigation here while the action runs, before its
  redirect takes over) or if a JS-enabled submission somehow lands on a full
  page navigation instead of being intercepted.
-->
<svelte:head>
  <title>Signing out - Tribunal</title>
</svelte:head>

<main class="logout-page">
  <p>Signing out...</p>
</main>

<style>
  .logout-page {
    display: grid;
    min-height: 100vh;
    place-items: center;
    padding: var(--space-6);
    color: var(--text-muted);
  }
</style>
