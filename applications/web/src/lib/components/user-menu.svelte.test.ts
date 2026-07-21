import { createRawSnippet } from 'svelte';
import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import UserMenu from './user-menu.svelte';

const TEST_USER = { username: 'testuser', avatarUrl: null };

/**
 * Wait for the trigger to be interactive before opening the dropdown. Under
 * full-suite coverage runs Chromium render can be starved; asserting
 * visibility first makes the readiness wait explicit and failures diagnosable
 * (readiness vs. click behavior).
 */
async function openUserMenu() {
  const trigger = page.getByRole('button', { name: 'User menu' });
  await expect.element(trigger).toBeVisible();
  await trigger.click();
}

describe('UserMenu', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the user avatar trigger button', async () => {
    render(UserMenu, { id: 'test-menu', user: TEST_USER });
    const trigger = page.getByRole('button', { name: 'User menu' });
    await expect.element(trigger).toBeInTheDocument();
  });

  it('submits the logout form when Sign out is clicked', async () => {
    render(UserMenu, { id: 'test-menu', user: TEST_USER });

    await openUserMenu();

    // Dropdown.Item renders with role="menuitem", not role="button"
    const signOutItem = page.getByRole('menuitem', { name: /sign out/i });
    await expect.element(signOutItem).toBeInTheDocument();

    const form = document.querySelector<HTMLFormElement>('form[action="/logout"]')!;
    expect(form.id).toBe('test-menu-logout-form');
    expect(form.method).toBe('post');
    expect(form.hidden).toBe(true);
    await expect.element(signOutItem).toHaveAttribute('type', 'submit');
    await expect.element(signOutItem).toHaveAttribute('form', form.id);

    const submitSpy = vi.fn((e: Event) => e.preventDefault());
    form.addEventListener('submit', submitSpy);

    await signOutItem.click();

    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it('displays the username in the dropdown label', async () => {
    render(UserMenu, { id: 'test-menu', user: TEST_USER });
    await openUserMenu();
    // Use exact class to scope away from the Avatar alt text match
    const usernameLabel = document.querySelector<HTMLElement>('.user-menu-username');
    expect(usernameLabel).not.toBeNull();
    expect(usernameLabel!.textContent).toBe('testuser');
  });

  it('renders extra menu content before the sign-out item when children are provided', async () => {
    const extraItem = createRawSnippet(() => ({
      render: () => '<div role="menuitem">Custom action</div>',
    }));

    render(UserMenu, { id: 'test-menu', user: TEST_USER, children: extraItem });
    await openUserMenu();

    await expect.element(page.getByRole('menuitem', { name: 'Custom action' })).toBeVisible();
    await expect.element(page.getByRole('menuitem', { name: /sign out/i })).toBeVisible();
  });
});
