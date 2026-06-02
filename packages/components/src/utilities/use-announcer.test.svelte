<script lang="ts">
  import { useAnnouncer, type AnnouncerOptions } from './use-announcer.svelte';

  type Props = {
    options?: AnnouncerOptions;
    onCreated?: (announcer: ReturnType<typeof useAnnouncer>) => void;
  };

  // Note: options is captured at mount time intentionally - tests don't change options mid-run
  let { options: initialOptions, onCreated }: Props = $props();

  // svelte-ignore state_referenced_locally
  const announcer = useAnnouncer(initialOptions);

  // Expose announcer to test via callback
  $effect(() => {
    onCreated?.(announcer);
  });
</script>

<div data-testid="message">{announcer.message}</div>
<div aria-live="polite" aria-atomic="true" class="sr-only">
  {announcer.message}
</div>
