import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth/dev-auth-bypass-flag', () => ({ isDevAuthBypassEnabled: vi.fn() }));

import { isDevAuthBypassEnabled } from '$lib/server/auth/dev-auth-bypass-flag';
import { handleUnauthenticatedAuthorization } from './unauthenticated';

describe('handleUnauthenticatedAuthorization', () => {
  beforeEach(() => {
    vi.mocked(isDevAuthBypassEnabled).mockReturnValue(false);
  });

  it('redirects to login preserving the original authorize URL as returnTo', async () => {
    const response = await handleUnauthenticatedAuthorization(
      new Request('http://localhost/oauth/authorize?client_id=x&scope=repositories:read'),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `/login?returnTo=${encodeURIComponent('/oauth/authorize?client_id=x&scope=repositories:read')}`,
    );
  });

  it('returns a terminal 403 under the dev auth bypass instead of a login redirect (TRI-45)', async () => {
    // The bypass user is authenticated on /login, so a redirect there would
    // bounce back to /oauth/authorize forever. A terminal denial breaks the loop.
    vi.mocked(isDevAuthBypassEnabled).mockReturnValue(true);
    const response = await handleUnauthenticatedAuthorization(
      new Request('http://localhost/oauth/authorize?client_id=x'),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
    await expect(response.text()).resolves.toMatch(/development auth bypass cannot authorize/i);
  });
});
