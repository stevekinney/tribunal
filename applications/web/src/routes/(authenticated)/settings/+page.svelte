<script lang="ts">
  import Page from '$lib/components/page.svelte';
  import { Alert } from '@lostgradient/cinder/alert';
  import { Button } from '@lostgradient/cinder/button';
  import { Card } from '@lostgradient/cinder/card';
  import { ConfirmDialog } from '@lostgradient/cinder/confirm-dialog';
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

  // The persisted value at load time, captured once (not reactive) so the
  // kill switch can tell a staged local toggle apart from the saved setting
  // and show an "unsaved change" state until the form is actually submitted.
  const savedReviewsEnabled = untrack(() => data.settings.reviewsEnabled);

  const modelOptions = $derived<{ value: string; label: string }[]>(
    data.modelOptions.map((model) => ({ value: model, label: model })),
  );

  const reviewStatus = $derived(reviewsEnabled ? 'success' : 'neutral');

  const reviewLabel = $derived(reviewsEnabled ? 'Reviews active' : 'Reviews paused');

  const hasUnsavedKillSwitchChange = $derived(reviewsEnabled !== savedReviewsEnabled);

  const toggleLabel = $derived(reviewsEnabled ? 'Pause reviews' : 'Resume reviews');

  // Turning the kill switch off is a global, immediate, blast-radius action, so
  // it requires an explicit confirmation. Turning it back on is a normal,
  // reversible toggle and does not need one. `onValueChange` can veto the
  // proposed value synchronously; the confirm dialog resolves the change later.
  let confirmPauseOpen = $state(false);

  function handleReviewsToggle(next: boolean): boolean | void {
    if (!next && reviewsEnabled) {
      confirmPauseOpen = true;
      return true;
    }
    reviewsEnabled = next;
  }

  function confirmPause() {
    reviewsEnabled = false;
    confirmPauseOpen = false;
  }

  function cancelPause() {
    confirmPauseOpen = false;
  }
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

    <Card tone="danger">
      {#snippet header()}
        <span class="kill-switch-eyebrow">Danger zone</span>
        <h2 class="kill-switch-title">
          <span aria-hidden="true"><OctagonAlert size={15} /></span>
          Kill switch
        </h2>
        <p class="kill-switch-desc">
          Immediately stops new run and automation dispatch across every repository. In-flight runs
          keep going unless a separate cancellation control stops them. Use this if costs spike or
          an agent misbehaves.
        </p>
      {/snippet}
      <div class="kill-switch-body">
        <div class="kill-switch-status">
          <StatusDot status={reviewStatus} label={reviewLabel} showLabel />
          {#if hasUnsavedKillSwitchChange}
            <Alert variant="warning">
              Unsaved change — save settings to {reviewsEnabled ? 'resume' : 'pause'} dispatch.
            </Alert>
          {/if}
        </div>
        <Toggle
          id="reviews-enabled"
          checked={reviewsEnabled}
          onValueChange={handleReviewsToggle}
          name="reviewsEnabled"
          label={toggleLabel}
        />
      </div>
    </Card>

    <ConfirmDialog
      bind:open={confirmPauseOpen}
      title="Pause reviews?"
      description="This stops new run and automation dispatch across every repository immediately. In-flight runs keep going."
      confirmLabel="Pause reviews"
      destructive
      onconfirm={confirmPause}
      oncancel={cancelPause}
    />

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

  .kill-switch-eyebrow {
    display: block;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide, 0.05em);
    color: var(--cinder-color-danger-fg);
    margin: 0 0 var(--space-1);
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

  .kill-switch-status {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
