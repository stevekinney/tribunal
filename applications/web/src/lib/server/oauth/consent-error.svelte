<script lang="ts">
  import { Card } from '@lostgradient/cinder/card';
  import { Stack } from '@lostgradient/cinder/stack';

  let { error }: { error: string } = $props();
</script>

<svelte:head>
  <title>Authorization error</title>
</svelte:head>

<main class="consent">
  <Card tone="danger">
    <!-- Only Cinder's stylesheet is inlined here, so custom properties fall back
         to literals. -->
    <Stack direction="column" gap="var(--space-3, 0.75rem)">
      <h1>Authorization error</h1>
      <p>{error}</p>
      <!-- The client is unverified in this branch, so there is nothing safe to
           redirect back to; give the user a way out instead of a dead end. -->
      <p>You can close this window and try again from your application.</p>
    </Stack>
  </Card>
</main>

<!-- Layout styles live in consent.ts's inlined <style> (CONSENT_LAYOUT_CSS);
     component <style> blocks are dropped by render() on this mount-owned page. -->
