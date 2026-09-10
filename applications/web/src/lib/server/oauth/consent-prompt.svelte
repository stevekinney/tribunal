<script lang="ts">
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Stack } from '@lostgradient/cinder/stack';

  type ScopeEntry = { scope: string; description: string };

  // The two hidden fields the library posts back with (transaction id + one-time
  // CSRF token). Names come from the library's `authorizeFormParameterNames`, so
  // the values travel in the POST body — never a URL.
  let {
    transactionIdField,
    csrfTokenField,
    transactionId,
    csrfToken,
    clientName,
    requesterLabel,
    redirectUri,
    scopes,
  }: {
    transactionIdField: string;
    csrfTokenField: string;
    transactionId: string;
    csrfToken: string;
    clientName: string;
    requesterLabel: string;
    redirectUri: string;
    scopes: ScopeEntry[];
  } = $props();
</script>

<svelte:head>
  <title>Authorize access</title>
</svelte:head>

<main class="consent">
  <Card>
    <!-- The page inlines only Cinder's stylesheet, not Tribunal's app tokens, so
         every custom property used here carries a literal fallback. -->
    <Stack direction="column" gap="var(--space-4, 1rem)">
      <h1>Authorize access</h1>
      <p>
        <strong>{clientName}</strong> is requesting access to your Tribunal account ({requesterLabel}).
      </p>
      <p>After you approve, it is redirected to <code>{redirectUri}</code> and will be able to:</p>
      <ul class="consent__scopes">
        {#each scopes as entry (entry.scope)}
          <li>
            <strong>{entry.scope}</strong>
            <span>{entry.description}</span>
          </li>
        {/each}
      </ul>
      <Stack direction="row" gap="var(--space-3, 0.75rem)" wrap>
        <form method="post" action="/oauth/authorize/approve">
          <input type="hidden" name={transactionIdField} value={transactionId} />
          <input type="hidden" name={csrfTokenField} value={csrfToken} />
          <Button type="submit" variant="primary" label="Approve" />
        </form>
        <form method="post" action="/oauth/authorize/deny">
          <input type="hidden" name={transactionIdField} value={transactionId} />
          <input type="hidden" name={csrfTokenField} value={csrfToken} />
          <Button type="submit" variant="secondary" label="Deny" />
        </form>
      </Stack>
    </Stack>
  </Card>
</main>

<!-- Layout styles for this page live in consent.ts's inlined <style> (see
     CONSENT_LAYOUT_CSS): svelte/server's render() drops component <style> blocks,
     and this response bypasses SvelteKit's CSS-linking pipeline. -->
