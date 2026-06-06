import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import UserMenu from './user-menu.svelte';

const TEST_USER = { username: 'testuser', avatarUrl: null };

describe('UserMenu', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the user avatar trigger button', async () => {
    render(UserMenu, { props: { id: 'test-menu', user: TEST_USER } });
    const trigger = page.getByRole('button', { name: 'User menu' });
    await expect.element(trigger).toBeInTheDocument();
  });

  it('submits the logout form when Sign out is clicked', async () => {
    render(UserMenu, { props: { id: 'test-menu', user: TEST_USER } });

    // Open the dropdown
    await page.getByRole('button', { name: 'User menu' }).click();

    // The sign-out item should be visible
    const signOutButton = page.getByRole('button', { name: /sign out/i });
    await expect.element(signOutButton).toBeInTheDocument();

    // Spy on form submission
    const submitSpy = vi.fn((e: Event) => e.preventDefault());
    const form = document.querySelector<HTMLFormElement>('form[action="/logout"]')!;
    form.addEventListener('submit', submitSpy);

    await signOutButton.click();

    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it('displays the username in the dropdown label', async () => {
    render(UserMenu, { props: { id: 'test-menu', user: TEST_USER } });
    await page.getByRole('button', { name: 'User menu' }).click();
    await expect.element(page.getByText('testuser')).toBeInTheDocument();
  });
});
