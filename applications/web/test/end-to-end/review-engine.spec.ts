import { expect, test } from '@playwright/test';
import { createE2ESession, e2eHeaders } from './helpers';

test('fake-backed review lifecycle covers open, synchronize, close, redelivery, and cost rollup', async ({
  page,
  request,
}, testInfo) => {
  const session = await createE2ESession(page, request, testInfo);
  const baseEvent = {
    userId: session.user.id,
    repositoryId: session.repository.id,
    pullRequestNumber: 23,
  };

  const opened = await request.post('/__e2e__/review-lifecycle', {
    headers: e2eHeaders(session.workerId),
    data: { ...baseEvent, kind: 'opened', headSha: 'open-sha', deliveryId: 'delivery-open' },
  });
  expect(opened.ok()).toBe(true);
  await expect(opened.json()).resolves.toMatchObject({
    status: 'posted',
    duplicateCostEvents: 0,
  });

  const redelivered = await request.post('/__e2e__/review-lifecycle', {
    headers: e2eHeaders(session.workerId),
    data: { ...baseEvent, kind: 'redelivered', headSha: 'open-sha', deliveryId: 'delivery-open' },
  });
  expect(redelivered.ok()).toBe(true);
  await expect(redelivered.json()).resolves.toMatchObject({
    status: 'posted',
    duplicateCostEvents: 0,
  });

  const synchronized = await request.post('/__e2e__/review-lifecycle', {
    headers: e2eHeaders(session.workerId),
    data: {
      ...baseEvent,
      kind: 'synchronize',
      headSha: 'synchronize-sha',
      deliveryId: 'delivery-sync',
    },
  });
  expect(synchronized.ok()).toBe(true);
  const synchronizedPayload = (await synchronized.json()) as { totalCostUsd: number };
  expect(synchronizedPayload.totalCostUsd).toBeGreaterThan(0);

  const closed = await request.post('/__e2e__/review-lifecycle', {
    headers: e2eHeaders(session.workerId),
    data: { ...baseEvent, kind: 'closed', headSha: 'closed-sha', deliveryId: 'delivery-close' },
  });
  expect(closed.ok()).toBe(true);
  await expect(closed.json()).resolves.toMatchObject({ status: 'closed' });

  await page.goto('/runs');
  await expect(page.getByRole('table', { name: 'Review runs' })).toContainText('cancelled');

  await page.goto('/costs');
  await expect(page.getByText('byReviewRun')).toBeVisible();
  await expect(
    page.getByRole('rowheader', { name: /Run run-e2e-.*open-sha-opened/ }),
  ).toBeVisible();
});
