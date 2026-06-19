<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Card } from '@lostgradient/cinder/card';
  import { Link } from '@lostgradient/cinder/link';

  let { data } = $props();

  const meterValue = $derived(
    data.costs.dailyCostCapUsd === 0
      ? 100
      : Math.min(100, (data.costs.todayTotalUsd / data.costs.dailyCostCapUsd) * 100),
  );
</script>

<Page title="Costs" subtitle="Estimated and reconciled review spend">
  <div class="toggle" aria-label="Cost source">
    <Link href="/costs?source=estimate" data-active={data.costs.source === 'estimate'}
      >Estimate</Link
    >
    <Link href="/costs?source=reconciled" data-active={data.costs.source === 'reconciled'}>
      Reconciled
    </Link>
  </div>

  <Card>
    <div class="cap-row">
      <div>
        <h2>Today vs. daily cap</h2>
        <p>${data.costs.todayTotalUsd.toFixed(2)} of ${data.costs.dailyCostCapUsd.toFixed(2)}</p>
      </div>
      <meter min="0" max="100" value={meterValue}>{meterValue.toFixed(0)}%</meter>
    </div>
  </Card>

  <div class="rollup-grid">
    {#each Object.entries(data.costs.rollups) as [name, rows] (name)}
      <Card>
        <h2>{name}</h2>
        {#if rows.length === 0}
          <p class="muted">No cost events.</p>
        {:else}
          <table>
            <tbody>
              {#each rows as row (row.label)}
                <tr>
                  <th>{row.label}</th>
                  <td>${row.amountUsd.toFixed(2)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </Card>
    {/each}
  </div>

  <Card>
    <h2>Prompt cache split</h2>
    <p>Creation tokens: {data.costs.cacheTokens.cacheCreationTokens}</p>
    <p>Read tokens: {data.costs.cacheTokens.cacheReadTokens}</p>
  </Card>
</Page>

<style>
  .toggle {
    display: inline-flex;
    width: fit-content;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .toggle :global(a) {
    padding: var(--space-2) var(--space-3);
    color: var(--text-muted);
  }

  .toggle :global(a[data-active='true']) {
    background: var(--surface-overlay);
    color: var(--text);
  }

  .cap-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  meter {
    width: min(20rem, 100%);
  }

  .rollup-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: var(--space-4);
  }

  h2 {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--text);
  }

  p,
  .muted {
    color: var(--text-muted);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: var(--space-3);
  }

  th,
  td {
    padding-block: var(--space-2);
    border-top: 1px solid var(--border-muted);
    text-align: left;
  }

  td {
    text-align: right;
    color: var(--text);
  }
</style>
