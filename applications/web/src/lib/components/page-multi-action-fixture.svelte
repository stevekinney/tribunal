<!--
  Test-only fixture for page.svelte.test.ts.

  Reproduces the real-world shape that caused the "canyon of whitespace" /
  "scattered action row" complaint, using the SAME components, labels, icons,
  and Button props as the actual `pageActions` snippet on the pull-requests
  page (`repositories/[repositoryId=int]/pull-requests/+page.svelte`) — a
  Link followed by three icon Buttons. Bare `<a>`/`<button>` elements
  understate real width (no Cinder padding/icon/font sizing), which would
  make the narrow-viewport overflow test in page.svelte.test.ts pass even if
  the fix didn't actually prevent overflow with real content. `createRawSnippet`
  cannot construct this in a plain .test.ts file because its `render` function
  requires a single root element, so this fixture supplies a real multi-node
  `{#snippet}` block instead.
-->
<script lang="ts">
  import Page from './page.svelte';
  import { Button } from '@lostgradient/cinder/button';
  import { Link } from '@lostgradient/cinder/link';
  import Settings from 'lucide-svelte/icons/settings';
  import WebhookIcon from 'lucide-svelte/icons/webhook';
  import ZapIcon from 'lucide-svelte/icons/zap';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<Page title="Pull requests">
  {#snippet actions()}
    <Link href="/issues">Issues</Link>
    <Button href="/events" variant="secondary" size="sm">
      {#snippet leadingIcon()}<ZapIcon size={14} aria-hidden="true" />{/snippet}
      Events
    </Button>
    <Button href="/webhooks" variant="secondary" size="sm">
      {#snippet leadingIcon()}<WebhookIcon size={14} aria-hidden="true" />{/snippet}
      Webhooks
    </Button>
    <Button href="/settings" variant="secondary" size="sm">
      {#snippet leadingIcon()}<Settings size={14} aria-hidden="true" />{/snippet}
      Repository settings
    </Button>
  {/snippet}

  {@render children()}
</Page>
