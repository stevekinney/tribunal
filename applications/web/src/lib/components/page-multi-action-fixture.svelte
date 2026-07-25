<!--
  Test-only fixture for page.svelte.test.ts.

  Reproduces the real-world shape that caused the "canyon of whitespace" /
  "scattered action row" complaint: an `actions` snippet with several sibling
  root nodes (a Link followed by three Buttons — the same shape as the
  pull-requests page's action row). `createRawSnippet` cannot construct this
  in a plain .test.ts file because its `render` function requires a single
  root element, so this fixture supplies a real multi-node `{#snippet}` block
  instead.
-->
<script lang="ts">
  import Page from './page.svelte';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<Page title="Pull requests">
  {#snippet actions()}
    <a href="/one">One</a>
    <button type="button">Two</button>
    <button type="button">Three</button>
  {/snippet}

  {@render children()}
</Page>
