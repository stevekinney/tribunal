import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import LogoutPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  goto: vi.fn(),
  signOut: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto,
}));

vi.mock('$lib/auth/neon-client', () => ({
  getNeonAuthClient: () => ({
    signOut: mocks.signOut,
  }),
}));

describe('/logout page', () => {
  beforeEach(() => {
    mocks.goto.mockReset();
    mocks.signOut.mockReset();
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows a signing-out message', async () => {
    mocks.signOut.mockResolvedValueOnce(undefined);

    render(LogoutPage);

    await expect.element(page.getByText('Signing out...')).toBeVisible();
  });

  it('clears the Neon session, calls the logout endpoint, and redirects home', async () => {
    mocks.signOut.mockResolvedValueOnce(undefined);

    render(LogoutPage);

    await vi.waitFor(() => {
      expect(mocks.signOut).toHaveBeenCalledTimes(1);
      expect(mocks.fetch).toHaveBeenCalledWith('/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      expect(mocks.goto).toHaveBeenCalledWith('/');
    });
  });

  it('still clears the bridge cookie and redirects when Neon Auth is unreachable', async () => {
    mocks.signOut.mockRejectedValueOnce(new Error('network unreachable'));

    render(LogoutPage);

    await vi.waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith('/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      expect(mocks.goto).toHaveBeenCalledWith('/');
    });
  });
});
