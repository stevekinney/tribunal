<script lang="ts">
  import { Card } from '@lostgradient/cinder/card';
  import { Stack } from '@lostgradient/cinder/stack';

  let { error }: { error: string } = $props();
</script>

<main class="consent">
  <Card tone="danger">
    <Stack direction="column" gap="var(--space-3)">
      <h1>Authorization error</h1>
      <p>{error}</p>
    </Stack>
  </Card>
</main>

<style>
  .consent {
    max-width: 32rem;
    margin: var(--space-8, 2rem) auto;
    padding: var(--space-4, 1rem);
  }
</style>
