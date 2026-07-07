<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { Input } from '@lostgradient/cinder/input';
  import { Select } from '@lostgradient/cinder/select';
  import { StatusDot } from '@lostgradient/cinder/status-dot';
  import { Toggle } from '@lostgradient/cinder/toggle';
  import OctagonAlert from 'lucide-svelte/icons/octagon-alert';
  import Save from 'lucide-svelte/icons/save';
  import { untrack } from 'svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  // Editable form state seeded once from server data (untrack avoids the
  // state_referenced_locally warning; matches the agents page pattern).
  let dailyCostCapUsd = $state(untrack(() => data.settings.dailyCostCapUsd));
  let defaultModel = $state(untrack(() => data.settings.defaultModel));
  let reviewsEnabled = $state(untrack(() => data.settings.reviewsEnabled));

  const modelOptions = $derived<{ value: string; label: string }[]>(
    data.modelOptions.map((model) => ({ value: model, label: model })),
  );

  const reviewStatus = $derived(reviewsEnabled ? 'success' : 'neutral');

  const reviewLabel = $derived(reviewsEnabled ? 'Reviews active' : 'Reviews paused');
</script>

<Page title="Settings" subtitle="Review safety controls">
  {#if form?.error}
    <Alert variant="danger">{form.error}</Alert>
  {/if}

  <form id="settings-form" method="POST" action="?/save" class="settings-form">
    <Card
      title="Daily cost cap"
      description="Reviews pause automatically once the day's estimated spend reaches this amount."
      headingLevel={2}
    >
      <div class="cost-cap-body">
        <div class="cost-input-wrapper">
          <Input
            id="daily-cost-cap"
            type="number"
            name="dailyCostCapUsd"
            bind:value={dailyCostCapUsd}
            min={0}
            step={0.01}
            required
            label="Daily cost cap in US dollars"
            hideLabel
          >
            {#snippet leading()}<span aria-hidden="true">$</span>{/snippet}
          </Input>
        </div>
      </div>
    </Card>

    <Card
      title="Default model"
      description="Used by any agent set to 'Inherit default.' Changing it does not affect agents with an explicit model."
      headingLevel={2}
    >
      <div class="model-body">
        <Select
          id="default-model"
          name="defaultModel"
          bind:value={defaultModel}
          options={modelOptions}
          label="Default model"
        />
      </div>
    </Card>

    <Card>
      {#snippet header()}
        <h2 class="kill-switch-title">
          <span aria-hidden="true"><OctagonAlert size={15} /></span>
          Kill switch
        </h2>
        <p class="kill-switch-desc">
          Immediately stop dispatching new reviews everywhere. In-flight runs finish. Use this if
          costs spike or an agent misbehaves.
        </p>
      {/snippet}
      <div class="kill-switch-body">
        <StatusDot status={reviewStatus} label={reviewLabel} showLabel />
        <Toggle
          id="reviews-enabled"
          bind:checked={reviewsEnabled}
          name="reviewsEnabled"
          label="Reviews enabled"
        />
      </div>
    </Card>

    <div class="form-actions">
      <Button type="submit" variant="primary">
        {#snippet leadingIcon()}<Save size={14} aria-hidden="true" />{/snippet}
        Save settings
      </Button>
    </div>
  </form>
</Page>

<style>
  .settings-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 680px;
  }

  .cost-cap-body {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .cost-input-wrapper {
    width: 160px;
  }

  .model-body {
    max-width: 280px;
  }

  .kill-switch-title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--cinder-color-danger-fg);
    margin: 0;
  }

  .kill-switch-desc {
    font-size: var(--text-sm);
    color: var(--text-subtle);
    margin: 0;
    margin-top: var(--space-1-5);
  }

  .kill-switch-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
