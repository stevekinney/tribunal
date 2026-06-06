<script lang="ts">
  let { children } = $props();
</script>

<!--
  Public routes (privacy policy, terms) render directly under the root layout,
  which provides no <main> landmark. The shared page.svelte component is a
  plain <div> wrapper (the authenticated layout owns its own <main>), so this
  layout supplies the single primary-content landmark for assistive tech.
-->
<main id="main-content">
  {@render children()}
</main>

<style>
  #main-content {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: var(--surface);
  }
</style>
