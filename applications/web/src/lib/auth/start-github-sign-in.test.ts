import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSignInSocial } = vi.hoisted(() => ({
  mockSignInSocial: vi.fn(),
}));

vi.mock('./neon-client', () => ({
  getNeonAuthClient: () => ({
    signIn: { social: mockSignInSocial },
  }),
}));

import { startGithubSignIn } from './start-github-sign-in';

const ORIGIN = 'https://tribunal.example';

describe('startGithubSignIn', () => {
  beforeEach(() => {
    mockSignInSocial.mockReset();
  });

  it('starts the OAuth flow and navigates to the returned GitHub URL', async () => {
    mockSignInSocial.mockResolvedValue({
      data: { url: 'https://github.com/login/oauth/authorize' },
    });
    const navigate = vi.fn();

    await startGithubSignIn({
      neonAuthConfigured: true,
      returnTo: '/repositories',
      origin: ORIGIN,
      navigate,
    });

    expect(navigate).toHaveBeenCalledWith('https://github.com/login/oauth/authorize');
    const [signInOptions] = mockSignInSocial.mock.calls[0];
    expect(signInOptions.callbackURL).toBe(`${ORIGIN}/auth/callback?returnTo=%2Frepositories`);
  });

  it('navigates to a config error and rethrows when Neon Auth is not configured', async () => {
    const navigate = vi.fn();

    await expect(
      startGithubSignIn({ neonAuthConfigured: false, returnTo: '/', origin: ORIGIN, navigate }),
    ).rejects.toThrow();

    expect(mockSignInSocial).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/login?error=neon_auth_not_configured&returnTo=%2F');
  });

  it('navigates to a failure error and rethrows when the OAuth request rejects', async () => {
    mockSignInSocial.mockRejectedValue(new Error('network error'));
    const navigate = vi.fn();

    await expect(
      startGithubSignIn({
        neonAuthConfigured: true,
        returnTo: '/repositories',
        origin: ORIGIN,
        navigate,
      }),
    ).rejects.toThrow('network error');

    expect(navigate).toHaveBeenCalledWith('/login?error=neon_auth_failed&returnTo=%2Frepositories');
  });

  it('navigates to a failure error and rethrows when Neon Auth returns no URL', async () => {
    mockSignInSocial.mockResolvedValue({ data: null });
    const navigate = vi.fn();

    await expect(
      startGithubSignIn({ neonAuthConfigured: true, returnTo: '/', origin: ORIGIN, navigate }),
    ).rejects.toThrow('did not return a GitHub OAuth URL');

    expect(navigate).toHaveBeenCalledWith('/login?error=neon_auth_failed&returnTo=%2F');
  });

  describe('default origin and navigate (no overrides supplied)', () => {
    // `defaultNavigate` and the default `origin` both read `window`, which
    // doesn't exist in this node test environment by default. Stubbing a
    // plain object as `globalThis.window` is not a DOM/jsdom dependency --
    // it's just a global property assignment -- so this covers the real
    // production defaults without forcing a browser project.
    const originalWindow = (globalThis as { window?: unknown }).window;

    afterEach(() => {
      if (originalWindow === undefined) {
        Reflect.deleteProperty(globalThis, 'window');
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    });

    it('reads window.location.origin and navigates via window.location.href when no overrides are given', async () => {
      const fakeWindow = { location: { origin: 'https://tribunal.test', href: '' } };
      vi.stubGlobal('window', fakeWindow);
      mockSignInSocial.mockResolvedValue({
        data: { url: 'https://github.com/login/oauth/authorize' },
      });

      await startGithubSignIn({ neonAuthConfigured: true, returnTo: '/repositories' });

      const [signInOptions] = mockSignInSocial.mock.calls[0];
      expect(signInOptions.callbackURL).toBe(
        'https://tribunal.test/auth/callback?returnTo=%2Frepositories',
      );
      expect(fakeWindow.location.href).toBe('https://github.com/login/oauth/authorize');
    });
  });
});
