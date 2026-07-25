import { expect, test } from '@playwright/test';
import { createE2ESession } from '../helpers';

test('unwatching a repository redirects to the list and removes it', async ({
  page,
  request,
}, testInfo) => {
  const session = await createE2ESession(page, request, testInfo);
  const repositoryLabel = `${session.repository.owner}/${session.repository.name}`;

  await page.goto('/repositories');
  await expect(page.getByRole('link', { name: repositoryLabel })).toBeVisible();

  await page.goto(`/repositories/${session.repository.id}/settings`);
  await page.getByRole('button', { name: 'Stop watching' }).click();

  // Destructive per `.claude/rules/component-library.md`, so the confirm
  // button stays disabled until the repository name is typed.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Stop watching' })).toBeDisabled();
  await dialog.getByRole('textbox').fill(session.repository.name);
  await dialog.getByRole('button', { name: 'Stop watching' }).click();

  // The form is deliberately un-enhanced: this is a real cross-document POST
  // to `/repositories?/watch` followed by a 303. Asserting the URL and the
  // rendered list is the point — a mocked `requestSubmit()` in a component
  // test cannot show that the browser actually follows the redirect and
  // lands somewhere coherent, which is what `.claude/rules/testing.md`
  // requires for a navigation change.
  await expect(page).toHaveURL('/repositories');
  await expect(page.getByRole('heading', { name: 'Repositories', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: repositoryLabel })).not.toBeVisible();

  // `.claude/rules/testing.md` also requires back/forward coverage for any
  // route that changes page content. The hazard specific to a native POST is
  // that going back can land on the pre-submit page or re-offer the mutation:
  // the settings page must still render for a repository that is no longer
  // watched, and returning forward must not silently unwatch anything again.
  await page.goBack();
  await expect(page).toHaveURL(`/repositories/${session.repository.id}/settings`);
  await expect(page.getByRole('heading', { name: 'Repository settings' })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL('/repositories');
  await expect(page.getByRole('heading', { name: 'Repositories', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: repositoryLabel })).not.toBeVisible();
});
