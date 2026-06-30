<script lang="ts">
  import type { PageProps } from './$types';
  import Page from '$lib/components/page.svelte';
  import { Card } from '@lostgradient/cinder/card';
  import { Badge } from '@lostgradient/cinder/badge';
  import { SegmentedControl } from '@lostgradient/cinder/segmented-control';
  import { Segment } from '@lostgradient/cinder/segment';

  let { data }: PageProps = $props();

  type DimensionKey =
    | 'byReviewRun'
    | 'byPullRequest'
    | 'byRepository'
    | 'byAgent'
    | 'byAgentPerRepository'
    | 'byUserPerDay';

  const dimensions: { key: DimensionKey; label: string }[] = [
    { key: 'byReviewRun', label: 'By Review Run' },
    { key: 'byPullRequest', label: 'By Pull Request' },
    { key: 'byRepository', label: 'By Repository' },
    { key: 'byAgent', label: 'By Agent' },
    { key: 'byAgentPerRepository', label: 'By Agent per Repository' },
    { key: 'byUserPerDay', label: 'By User per Day' },
  ];

  function isDimensionKey(value: string): value is DimensionKey {
    return dimensions.some((d) => d.key === value);
  }

  let activeDimension = $state<DimensionKey>('byAgent');

  const meterValue = $derived(
    data.costs.dailyCostCapUsd === 0
      ? 100
      : Math.min(100, (data.costs.todayTotalUsd / data.costs.dailyCostCapUsd) * 100),
  );

  const capBadgeVariant = $derived<'success' | 'warning' | 'danger'>(
    meterValue >= 90 ? 'danger' : meterValue >= 70 ? 'warning' : 'success',
  );

  const activeRows = $derived(data.costs.rollups[activeDimension]);

  const maxRowAmount = $derived(
    activeRows.length > 0 ? Math.max(...activeRows.map((r) => r.amountUsd)) || 1 : 1,
  );

  const totalForDimension = $derived(activeRows.reduce((sum, r) => sum + r.amountUsd, 0));

  const totalCacheTokens = $derived(
    data.costs.cacheTokens.cacheReadTokens + data.costs.cacheTokens.cacheCreationTokens,
  );

  const cacheHitRate = $derived(
    totalCacheTokens > 0
      ? Math.round((data.costs.cacheTokens.cacheReadTokens / totalCacheTokens) * 100)
      : 0,
  );
</script>

<Page title="Costs" subtitle="Estimated and reconciled review spend">
  {#snippet actions()}
    <nav class="source-toggle" aria-label="Cost source">
      <a
        href="/costs?source=estimate"
        class="source-option"
        data-active={data.costs.source === 'estimate'}
        aria-current={data.costs.source === 'estimate' ? 'page' : undefined}>Estimate</a
      >
      <a
        href="/costs?source=reconciled"
        class="source-option"
        data-active={data.costs.source === 'reconciled'}
        aria-current={data.costs.source === 'reconciled' ? 'page' : undefined}>Reconciled</a
      >
    </nav>
  {/snippet}

  <div class="stats-grid">
    <Card>
      <div class="spend-card">
        <div class="spend-header">
          <span class="stat-label">Today's spend</span>
          <Badge variant={capBadgeVariant}>{meterValue.toFixed(0)}% of cap</Badge>
        </div>
        <div class="spend-amount">
          <span class="amount-primary">${data.costs.todayTotalUsd.toFixed(2)}</span>
          <span class="amount-cap">of ${data.costs.dailyCostCapUsd.toFixed(2)}</span>
        </div>
        <div
          class="progress-track"
          role="progressbar"
          aria-valuenow={Math.round(meterValue)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Today's spend vs daily cap"
        >
          <div class="progress-fill" style:width="{meterValue}%"></div>
        </div>
      </div>
    </Card>

    <Card>
      <div class="cache-card">
        <span class="stat-label">Prompt cache</span>
        <span class="amount-primary">{cacheHitRate}%</span>
        <span class="stat-sub"
          >Read tokens: {data.costs.cacheTokens.cacheReadTokens.toLocaleString('en-US')}</span
        >
        <span class="stat-sub"
          >Created tokens: {data.costs.cacheTokens.cacheCreationTokens.toLocaleString(
            'en-US',
          )}</span
        >
      </div>
    </Card>
  </div>

  <Card footerTone="muted">
    {#snippet header()}
      <div class="breakdown-header">
        <span class="breakdown-title">Breakdown</span>
        <SegmentedControl
          id="breakdown-dimension"
          label="Breakdown dimension"
          hideLabel
          density="toolbar"
          value={activeDimension}
          onchange={(v) => {
            if (isDimensionKey(v)) activeDimension = v;
          }}
        >
          {#each dimensions as dim (dim.key)}
            <Segment value={dim.key}>{dim.label}</Segment>
          {/each}
        </SegmentedControl>
      </div>
    {/snippet}

    {#if activeRows.length === 0}
      <p class="empty-note">No cost events for this dimension.</p>
    {:else}
      <div class="breakdown-rows">
        {#each activeRows as row (row.label)}
          <div class="breakdown-row">
            <span class="breakdown-label" title={row.label}>{row.label}</span>
            <div class="bar-track" aria-hidden="true">
              <div class="bar-fill" style:width="{(row.amountUsd / maxRowAmount) * 100}%"></div>
            </div>
            <span class="breakdown-amount">${row.amountUsd.toFixed(2)}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#snippet footer()}
      <div class="breakdown-footer">
        <span class="footer-note">
          {data.costs.source === 'estimate'
            ? 'Estimated from token counts. Reconciled figures arrive ~24 h after billing.'
            : 'Reconciled figures from billing.'}
        </span>
        <span class="footer-total">${totalForDimension.toFixed(2)} total</span>
      </div>
    {/snippet}
  </Card>
</Page>

<style>
  /* Source toggle */
  .source-toggle {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .source-option {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-muted);
    text-decoration: none;
    transition:
      background 0.1s,
      color 0.1s;
  }

  .source-option:hover {
    color: var(--text);
    background: var(--surface-overlay);
  }

  .source-option[aria-current='page'] {
    background: var(--surface-overlay);
    color: var(--text);
    font-weight: var(--font-medium);
  }

  /* Stats grid */
  .stats-grid {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: var(--space-4);
    align-items: stretch;
  }

  @media (max-width: 640px) {
    .stats-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Today's spend card */
  .spend-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .spend-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .spend-amount {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  /* Cache card */
  .cache-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;
    justify-content: center;
  }

  /* Shared stat styles */
  .stat-label {
    font-size: var(--text-xs);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: var(--font-medium);
  }

  .stat-sub {
    font-size: var(--text-xs);
    color: var(--text-subtle);
    font-family: var(--font-mono);
  }

  .amount-primary {
    font-size: var(--text-4xl);
    font-weight: var(--font-semibold);
    font-family: var(--font-mono);
    letter-spacing: -0.02em;
    color: var(--text);
  }

  .cache-card .amount-primary {
    font-size: var(--text-2xl);
  }

  .amount-cap {
    font-size: var(--text-base);
    color: var(--text-subtle);
    font-family: var(--font-mono);
  }

  /* Progress bar */
  .progress-track {
    height: 10px;
    border-radius: 999px;
    background: var(--cinder-surface-inset);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 0.3s ease;
  }

  /* Breakdown card header */
  .breakdown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    width: 100%;
  }

  .breakdown-title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--text);
  }

  /* Breakdown rows */
  .breakdown-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .breakdown-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .breakdown-label {
    width: 160px;
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar-track {
    flex: 1;
    height: 14px;
    border-radius: var(--radius-sm);
    background: var(--cinder-surface-inset);
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: var(--radius-sm);
    transition: width 0.2s ease;
  }

  .breakdown-amount {
    width: 72px;
    text-align: right;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text);
    flex-shrink: 0;
  }

  .empty-note {
    font-size: var(--text-sm);
    color: var(--text-muted);
    padding-block: var(--space-4);
    text-align: center;
  }

  /* Breakdown footer */
  .breakdown-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    width: 100%;
  }

  .footer-note {
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  .footer-total {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--text);
    flex-shrink: 0;
  }
</style>
