import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import UserMenu from './user-menu.svelte';

const TEST_USER = { username: 'testuser', avatarUrl: null };

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

    // Open the dropdown
    await page.getByRole('button', { name: 'User menu' }).click();

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
    await page.getByRole('button', { name: 'User menu' }).click();
    // Use exact class to scope away from the Avatar alt text match
    const usernameLabel = document.querySelector<HTMLElement>('.user-menu-username');
    expect(usernameLabel).not.toBeNull();
    expect(usernameLabel!.textContent).toBe('testuser');
  });
});
