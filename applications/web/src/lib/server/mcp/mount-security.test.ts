import { describe, expect, it, vi } from 'vitest';

// Force the production branch so the HSTS header is applied and asserted.
vi.mock('$app/environment', () => ({ dev: false }));

const { applyMcpSecurityHeaders, isMcpSurfacePath } = await import('./mount-hooks');

describe('isMcpSurfacePath', () => {
  it('matches the mount-owned paths and nothing else', () => {
    expect(isMcpSurfacePath('/mcp')).toBe(true);
    expect(isMcpSurfacePath('/oauth/authorize')).toBe(true);
    expect(isMcpSurfacePath('/.well-known/oauth-protected-resource')).toBe(true);
    expect(isMcpSurfacePath('/')).toBe(false);
    expect(isMcpSurfacePath('/repositories')).toBe(false);
  });
});

describe('applyMcpSecurityHeaders', () => {
  it('sets nosniff, permissions-policy, and production HSTS on every response', () => {
    const response = applyMcpSecurityHeaders(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
      '/.well-known/oauth-authorization-server',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('permissions-policy')).toContain('camera=()');
    expect(response.headers.get('strict-transport-security')).toContain('max-age=');
    // JSON responses keep the library's own caching headers.
    expect(response.headers.get('cache-control')).toBeNull();
    expect(response.headers.get('referrer-policy')).toBeNull();
  });

  it('adds no-referrer on OAuth transaction paths and no-store on HTML', () => {
    const response = applyMcpSecurityHeaders(
      new Response('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      '/oauth/authorize',
    );
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('vary')).toBe('Cookie');
  });
});
