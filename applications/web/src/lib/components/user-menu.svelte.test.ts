import { createRawSnippet } from 'svelte';
import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import UserMenu from './user-menu.svelte';

const TEST_USER = { username: 'testuser', avatarUrl: null };

const mocks = vi.hoisted(() => ({
  broadcastNeonSessionLogout: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('$lib/auth/neon-client', () => ({
  broadcastNeonSessionLogout: mocks.broadcastNeonSessionLogout,
  getNeonAuthClient: () => ({ signOut: mocks.signOut }),
}));

/**
 * Mirrors the real `use:enhance` contract closely enough for this test:
 * intercepts the native submit, awaits the passed submit function (the real
 * implementation awaits it too, before ever dispatching a fetch), and never
 * lets the form actually POST -- there's no real /logout server to hit in
 * this component test, and this file only needs to prove the submit
 * function runs, not exercise SvelteKit's own progressive-enhancement
 * plumbing (that's SvelteKit's own test suite's job).
 */
vi.mock('$app/forms', () => ({
  enhance: (
    formElement: HTMLFormElement,
    submitFunction?: () => void | Promise<void> | (() => void | Promise<void>),
  ) => {
    const handleSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      void submitFunction?.();
    };

    formElement.addEventListener('submit', handleSubmit);
    return {
      destroy() {
        formElement.removeEventListener('submit', handleSubmit);
      },
    };
  },
}));

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
    mocks.broadcastNeonSessionLogout.mockReset();
    mocks.signOut.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the user avatar trigger button', async () => {
    render(UserMenu, { id: 'test-menu', user: TEST_USER });
    const trigger = page.getByRole('button', { name: 'User menu' });
    await expect.element(trigger).toBeInTheDocument();
  });

  it('broadcasts the cross-tab logout signal and ends the Neon Auth session before submitting the logout form', async () => {
    render(UserMenu, { id: 'test-menu', user: TEST_USER });

    await openUserMenu();

    const signOutItem = page.getByRole('menuitem', { name: /sign out/i });
    await expect.element(signOutItem).toBeInTheDocument();

    const form = document.querySelector<HTMLFormElement>('form[action="/logout"]')!;
    expect(form.id).toBe('test-menu-logout-form');
    expect(form.method).toBe('post');
    expect(form.hidden).toBe(true);
    await expect.element(signOutItem).toHaveAttribute('type', 'submit');
    await expect.element(signOutItem).toHaveAttribute('form', form.id);

    await signOutItem.click();

    await vi.waitFor(() => {
      expect(mocks.broadcastNeonSessionLogout).toHaveBeenCalledTimes(1);
      expect(mocks.signOut).toHaveBeenCalledTimes(1);
    });
  });

  it('still submits the logout form (and logs, but does not throw) when ending the Neon Auth session fails', async () => {
    const signOutError = new Error('network unreachable');
    mocks.signOut.mockRejectedValueOnce(signOutError);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(UserMenu, { id: 'test-menu', user: TEST_USER });

    await openUserMenu();

    const signOutItem = page.getByRole('menuitem', { name: /sign out/i });
    await signOutItem.click();

    await vi.waitFor(() => {
      expect(mocks.broadcastNeonSessionLogout).toHaveBeenCalledTimes(1);
      expect(mocks.signOut).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to end the Neon Auth session during sign-out',
        signOutError,
      );
    });

    consoleErrorSpy.mockRestore();
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
