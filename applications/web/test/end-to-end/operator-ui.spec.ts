import { expect, test } from '@playwright/test';
import { createE2ESession } from './helpers';

test('operator UI happy path covers repositories, agents, runs, costs, and settings', async ({
  page,
  request,
}, testInfo) => {
  const session = await createE2ESession(page, request, testInfo);

  await page.goto('/repositories');
  await expect(page.getByRole('heading', { name: 'Repositories', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /e2e-owner-.*e2e-repository-/ })).toBeVisible();
  await expect(page.getByText('$0.42')).toBeVisible();

  await page.goto('/agents');
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'security-review' })).toBeVisible();
  await expect(page.getByText('Finds authentication and permission issues')).toBeVisible();

  await page.goto('/runs');
  await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Review runs' })).toContainText(
    `${session.repository.owner}/${session.repository.name} #17`,
  );
  await expect(page.getByRole('table', { name: 'Review runs' })).toContainText('Posted');

  await page.goto('/costs');
  await expect(page.getByRole('heading', { name: 'Costs' })).toBeVisible();
  await expect(page.getByText('$0.42 of $25.00')).toBeVisible();
  // The breakdown is a segmented single-dimension view defaulting to "By Agent";
  // the agent's cost row confirms per-agent attribution rendered.
  await expect(page.getByText('security-review', { exact: true })).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByLabel('Daily cost cap')).toHaveValue('25');
  await expect(page.getByLabel('Reviews enabled')).toBeChecked();
});
