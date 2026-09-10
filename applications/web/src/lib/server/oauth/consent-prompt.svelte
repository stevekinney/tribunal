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

<style>
  .consent {
    max-width: 32rem;
    margin: var(--space-8, 2rem) auto;
    padding: var(--space-4, 1rem);
    /* A native client's loopback redirect URI or a long client name must not
       force horizontal scroll on a narrow viewport. */
    overflow-wrap: anywhere;
  }

  /* Cinder's buttons top out below the 44px touch-target minimum; this page's
     entire interaction is these two buttons, and it is reachable from a mobile
     MCP client, so enforce the minimum locally (a sanctioned :global override of
     a component class). */
  .consent :global(.cinder-button) {
    min-height: var(--touch-target-min, 44px);
  }

  .consent__scopes {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 0.75rem);
    margin: 0;
    padding-left: var(--space-4, 1rem);
  }

  .consent__scopes li {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 0.25rem);
  }
</style>
