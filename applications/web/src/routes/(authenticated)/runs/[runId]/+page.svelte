<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Badge } from '@lostgradient/cinder/badge';
  import type { BadgeVariant } from '@lostgradient/cinder/badge';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { EventStreamViewer } from '@lostgradient/cinder/event-stream-viewer';
  import type { EventStreamState, StreamEvent } from '@lostgradient/cinder/event-stream-viewer';
  import { Link } from '@lostgradient/cinder/link';
  import { StatGroup } from '@lostgradient/cinder/stat-group';
  import { StatusDot } from '@lostgradient/cinder/status-dot';
  import type { StatusDotStatus } from '@lostgradient/cinder/status-dot';
  import { VisuallyHidden } from '@lostgradient/cinder/visually-hidden';
  import { invalidateAll } from '$app/navigation';
  import ExternalLink from 'lucide-svelte/icons/external-link';
  import { Square } from 'lucide-svelte';
  import { untrack } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type AgentRun = PageData['run']['agentRuns'][number];
  type AgentEvent = AgentRun['events'][number];

  const run = $derived(data.run);
  let connectionState = $state<'connecting' | 'streaming' | 'disconnected'>('disconnected');
  const canStopRun = $derived(run.status === 'running' || run.status === 'queued');
  const eventStreamConnectionState = $derived<EventStreamState>(
    canStopRun && connectionState === 'streaming'
      ? 'connected'
      : connectionState === 'connecting'
        ? 'connecting'
        : 'disconnected',
  );
  const connectionLabel = $derived(canStopRun ? connectionState : 'disconnected');
  const latestAgentEventId = $derived.by(() => {
    let latestId = 0;
    for (const agentRun of run.agentRuns) {
      for (const event of agentRun.events) {
        if (event.id > latestId) latestId = event.id;
      }
    }
    return latestId;
  });
  const replacementRunHref = $derived(
    run.replacementRunId === null ? null : `/runs/${run.replacementRunId}`,
  );
  const checkRunHref = $derived(
    run.runKind !== 'pull_request_review' || run.checkRunId === null
      ? null
      : `https://github.com/${run.repositoryOwner}/${run.repositoryName}/runs/${run.checkRunId}`,
  );
  const prHref = $derived(
    run.runKind === 'pull_request_review'
      ? `https://github.com/${run.repositoryOwner}/${run.repositoryName}/pull/${run.prNumber}`
      : null,
  );
  const runSubtitle = $derived(
    run.runKind === 'pull_request_review'
      ? `${run.repositoryOwner}/${run.repositoryName} · PR #${run.prNumber}`
      : `${run.repositoryOwner}/${run.repositoryName} · ${run.eventType}${run.action ? ` / ${run.action}` : ''}`,
  );
  const totalFindings = $derived(
    run.agentRuns.reduce((sum, agentRun) => sum + agentRun.findings.length, 0),
  );
  const estimatedCost = $derived(`$${Number(run.costEstimateUsd).toFixed(2)}`);

  function isDeniedToolEvent(detail: unknown): boolean {
    return (
      typeof detail === 'object' &&
      detail !== null &&
      (('denied' in detail && detail.denied === true) ||
        ('allowed' in detail && detail.allowed === false))
    );
  }

  function toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }

  function toDateTime(value: Date | string): string {
    const date = toDate(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  function toTimestamp(value: Date | string): string {
    const date = toDate(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function summarizeEvent(event: AgentEvent): string {
    const base = event.tool ? `${event.kind}: ${event.tool}` : event.kind;
    return event.kind === 'tool_pre' && isDeniedToolEvent(event.detail) ? `${base} blocked` : base;
  }

  function eventSeverity(event: AgentEvent): StreamEvent['severity'] {
    if (event.kind === 'tool_pre' && isDeniedToolEvent(event.detail)) return 'warning';
    if (event.kind.includes('error') || event.kind.includes('failed')) return 'error';
    return 'info';
  }

  function toStreamEvents(events: AgentEvent[]): StreamEvent[] {
    return events.map((event) => ({
      id: String(event.id),
      datetime: toDateTime(event.at),
      timestamp: toTimestamp(event.at),
      severity: eventSeverity(event),
      source: event.tool ?? undefined,
      summary: summarizeEvent(event),
      details: event.detail ?? undefined,
    }));
  }

  function canStopAgent(status: string): boolean {
    return status === 'running' || status === 'queued';
  }

  function githubCommentHref(commentId: number): string {
    if (run.runKind !== 'pull_request_review') return '';
    return `https://github.com/${run.repositoryOwner}/${run.repositoryName}/pull/${run.prNumber}#discussion_r${commentId}`;
  }

  function runStatusVariant(status: string): BadgeVariant {
    switch (status) {
      case 'running':
        // Match the runs list (STATUS_CONFIG.running.badge) so the same status reads identically.
        return 'accent';
      case 'posted':
        return 'success';
      case 'failed':
        return 'danger';
      case 'quota_blocked':
        return 'warning';
      default:
        return 'neutral';
    }
  }

  function agentStatusVariant(status: string): BadgeVariant {
    switch (status) {
      case 'running':
        return 'info';
      case 'succeeded':
        return 'success';
      case 'failed':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  function agentStatusDot(status: string): StatusDotStatus {
    switch (status) {
      case 'running':
        return 'accent';
      case 'succeeded':
        return 'success';
      case 'failed':
        return 'danger';
      case 'queued':
        return 'pending';
      default:
        return 'neutral';
    }
  }

  function findingSeverityVariant(severity: string): BadgeVariant {
    switch (severity) {
      case 'error':
        return 'danger';
      case 'warning':
        return 'warning';
      default:
        return 'info';
    }
  }

  function formatDurationMs(ms: number | null | undefined): string | null {
    if (ms == null) return null;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  function agentMetaSummary(agentRun: AgentRun): string | null {
    return formatDurationMs(agentRun.durationMs);
  }

  function formatStatus(status: string): string {
    const words = status.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  $effect(() => {
    if (!canStopRun) {
      connectionState = 'disconnected';
      return;
    }

    const fallbackRefresh = window.setInterval(() => void invalidateAll(), 10_000);

    if (typeof EventSource === 'undefined') {
      connectionState = 'disconnected';
      return () => window.clearInterval(fallbackRefresh);
    }

    connectionState = 'connecting';
    const initialAgentEventId = untrack(() => latestAgentEventId);
    let streamIsActive = true;
    const eventSource = new EventSource(
      `/api/review/runs/${run.id}/events?after=${initialAgentEventId}`,
    );

    eventSource.onopen = () => {
      if (!streamIsActive) return;
      connectionState = 'streaming';
    };

    eventSource.addEventListener('agent_event', () => {
      void invalidateAll();
    });

    eventSource.onerror = () => {
      if (!streamIsActive) return;
      connectionState = 'disconnected';
    };

    return () => {
      streamIsActive = false;
      window.clearInterval(fallbackRefresh);
      eventSource.close();
    };
  });
</script>

<Page
  title={`Run ${run.id}`}
  subtitle={runSubtitle}
  breadcrumbs={[{ label: 'Runs', href: '/runs' }, { label: `Run ${run.id}` }]}
>
  {#snippet actions()}
    <div class="page-actions">
      {#if prHref}
        <Button
          href={prHref}
          variant="secondary"
          size="sm"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open PR
          {#snippet trailingIcon()}<ExternalLink size={14} aria-hidden="true" />{/snippet}
        </Button>
      {/if}
      <form method="POST" action={`/api/review/runs/${run.id}/stop`}>
        <Button type="submit" variant="danger" size="sm" disabled={!canStopRun}>
          Stop run
          {#snippet leadingIcon()}<Square size={14} aria-hidden="true" />{/snippet}
        </Button>
      </form>
    </div>
  {/snippet}

  {#if run.error}
    <Alert variant="danger">{run.error}</Alert>
  {/if}

  <div class="status-row">
    <Badge variant={runStatusVariant(run.status)}>{formatStatus(run.status)}</Badge>
    {#if canStopRun}
      <StatusDot connectionState={eventStreamConnectionState} size="sm" />
    {/if}
    <VisuallyHidden aria-label="Run event stream state">{connectionLabel}</VisuallyHidden>
    {#if run.status === 'superseded'}
      {#if replacementRunHref}
        <Link href={replacementRunHref}>Superseded by a newer run</Link>
      {:else}
        <span class="text-muted">Superseded by a newer run</span>
      {/if}
    {/if}
  </div>

  <div class="run-summary">
    <StatGroup label="Run summary statistics" columns={3} variant="cards">
      <StatGroup.Stat label="Agents" value={run.agentRuns.length} />
      <StatGroup.Stat label="Est. cost" value={estimatedCost} />
      <StatGroup.Stat label="Findings" value={totalFindings} />
    </StatGroup>
    <Card padding="none">
      <div class="run-summary-detail">
        {#if run.runKind === 'pull_request_review'}
          <span class="run-summary-detail-label">Check run</span>
          {#if checkRunHref}
            <span class="run-summary-detail-link-value">
              <Link href={checkRunHref} external>Open GitHub Check Run</Link>
            </span>
          {:else}
            <span class="run-summary-detail-dash">—</span>
          {/if}
        {:else}
          <span class="run-summary-detail-label">Webhook event</span>
          <span class="run-summary-detail-value">#{run.webhookEventId}</span>
        {/if}
      </div>
    </Card>
  </div>

  <section class="agent-grid" aria-label="Agent timelines">
    {#if run.agentRuns.length === 0}
      <Card>
        <p class="empty-state">No agent runs recorded.</p>
      </Card>
    {/if}
    {#each run.agentRuns as agentRun (agentRun.id)}
      <Card padding="none">
        {#snippet header()}
          <div class="agent-header">
            <div class="agent-identity">
              <StatusDot
                status={agentStatusDot(agentRun.status)}
                showLabel={false}
                size="sm"
                aria-hidden="true"
              />
              <h2 class="agent-slug">{agentRun.slug}</h2>
              <Badge size="sm" variant={agentStatusVariant(agentRun.status)}>
                {formatStatus(agentRun.status)}
              </Badge>
            </div>
            <div class="agent-controls">
              {#if agentMetaSummary(agentRun)}
                <span class="agent-meta">{agentMetaSummary(agentRun)}</span>
              {/if}
              {#if canStopAgent(agentRun.status)}
                <form
                  method="POST"
                  action={`/api/review/runs/${run.id}/agents/${agentRun.agentId}/stop`}
                >
                  <Button
                    type="submit"
                    variant="soft-danger"
                    size="xs"
                    aria-label={`Stop ${agentRun.slug}`}
                  >
                    Stop
                  </Button>
                </form>
              {/if}
            </div>
          </div>
        {/snippet}

        {#if agentRun.description}
          <p class="agent-description">{agentRun.description}</p>
        {/if}

        <EventStreamViewer
          events={toStreamEvents(agentRun.events)}
          connectionState={canStopAgent(agentRun.status) ? eventStreamConnectionState : undefined}
          label={`${agentRun.slug} event stream`}
        />

        <div class="findings">
          <h3 class="findings-heading">Findings ({agentRun.findings.length})</h3>
          {#if agentRun.findings.length === 0}
            <p class="empty-state">No findings recorded.</p>
          {:else}
            <ul class="finding-list">
              {#each agentRun.findings as finding (finding.id)}
                <li class="finding-item">
                  <Badge size="sm" variant={findingSeverityVariant(finding.severity)}>
                    {formatStatus(finding.severity)}
                  </Badge>
                  <div class="finding-body">
                    <span class="finding-title">{finding.title}</span>
                    <span class="finding-location">
                      <code class="finding-path">
                        {finding.path}{finding.startLine != null ? `:${finding.startLine}` : ''}
                      </code>
                      {#if finding.githubCommentId && run.runKind === 'pull_request_review'}
                        <Link href={githubCommentHref(finding.githubCommentId)} external>
                          GitHub comment
                        </Link>
                      {/if}
                    </span>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </Card>
    {/each}
  </section>
</Page>

<style>
  /* ---- Page actions ---- */
  .page-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* ---- Status row ---- */
  .status-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .text-muted {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  /* ---- Run summary ---- */
  .run-summary {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(12rem, 1fr);
    gap: var(--space-3);
    align-items: stretch;
  }

  .run-summary-detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-4);
    height: 100%;
  }

  .run-summary-detail-label {
    font-size: var(--text-2xs);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: var(--font-medium);
  }

  .run-summary-detail-value {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--text);
    line-height: 1.2;
  }

  .run-summary-detail-dash {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--text-muted);
    line-height: 1.2;
  }

  .run-summary-detail-link-value {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    line-height: 1.2;
  }

  /* ---- Agent grid ---- */
  .agent-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: var(--space-4);
    align-items: start;
  }

  /* ---- Agent card header ---- */
  .agent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
  }

  .agent-identity {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .agent-slug {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .agent-meta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  .agent-description {
    margin: 0;
    padding: var(--space-3) var(--space-4) 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  /* ---- Findings ---- */
  .findings {
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border-muted);
  }

  .findings-heading {
    margin: 0 0 var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .finding-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .finding-item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .finding-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    font-size: var(--text-sm);
  }

  .finding-title {
    color: var(--text);
    line-height: 1.4;
  }

  .finding-location {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .finding-path {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .empty-state {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  /* ---- Responsive ---- */
  @media (max-width: 768px) {
    .agent-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 480px) {
    .run-summary {
      grid-template-columns: 1fr;
    }
  }
</style>
