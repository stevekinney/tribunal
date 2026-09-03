import { describe, expect, it } from 'vitest';
import { handleUnauthenticatedAuthorization } from './unauthenticated';

describe('handleUnauthenticatedAuthorization', () => {
  it('redirects to login preserving the original authorize URL as returnTo', async () => {
    const response = await handleUnauthenticatedAuthorization(
      new Request('http://localhost/oauth/authorize?client_id=x&scope=repositories:read'),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `/login?returnTo=${encodeURIComponent('/oauth/authorize?client_id=x&scope=repositories:read')}`,
    );
  });
});
