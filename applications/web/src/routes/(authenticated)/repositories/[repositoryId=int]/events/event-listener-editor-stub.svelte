<script lang="ts" module>
  /**
   * What this stub reports as its live document, deliberately different from
   * whatever the `value` binding holds. The real editor's `value` lags its
   * document by a few hundred milliseconds; this makes that gap permanent so a
   * test can prove which of the two actually gets submitted.
   */
  export const LIVE_EDITOR_MARKDOWN = 'live editor content';
</script>

<script lang="ts">
  // Only the two props event-listener-form.svelte binds to need declaring;
  // Svelte ignores the rest it passes.
  let { value = $bindable(''), mode = $bindable('wysiwyg') } = $props();

  export function getMarkdown(): string {
    return LIVE_EDITOR_MARKDOWN;
  }
</script>

<textarea aria-label="Instructions" bind:value></textarea>
<span hidden>{mode}</span>
