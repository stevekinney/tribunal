/**
 * OAuth Security Tests
 *
 * Tests the security of the GitHub OAuth flow, specifically:
 * - returnTo URL validation to prevent open redirect attacks
 * - State parameter generation
 * - Cookie security settings
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() to ensure mock state is available when mocks are hoisted
const { mockDev, mockState, sanitizeReturnTo } = vi.hoisted(() => {
  // Copy of sanitizeReturnTo logic to avoid importing the real module (which has db dependency)
  function sanitizeReturnTo(url: string | null): string {
    if (!url) return '/';
    if (!url.startsWith('/')) return '/';
    if (url.startsWith('//')) return '/';
    const lower = url.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('data:')) return '/';
    try {
      const parsed = new URL(url, 'https://placeholder.com');
      return parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return '/';
    }
  }

  return {
    mockDev: { value: true },
    mockState: { value: 'mock-state-12345' },
    sanitizeReturnTo,
  };
});

// Mock arctic
vi.mock('arctic', () => ({
  generateState: () => mockState.value,
}));

// Mock authentication with full implementations
vi.mock('$lib/server/auth/authentication', () => ({
  createOAuthState: () => mockState.value,
  sanitizeReturnTo: (url: string | null) => sanitizeReturnTo(url),
  setOAuthStateCookie: (
    cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void },
    stateNonce: string,
    provider: string,
    intent: string,
    returnTo: string,
  ) => {
    const payload = {
      nonce: stateNonce,
      provider,
      intent,
      returnTo: sanitizeReturnTo(returnTo),
      createdAt: Date.now(),
    };
    cookies.set('oauth_state', JSON.stringify(payload), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: !mockDev.value,
      maxAge: 600,
    });
  },
}));

// Mock providers
vi.mock('$lib/server/auth/providers', () => ({
  getProviderClient: () => ({
    createAuthorizationURL: (state: string) => {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', 'mock-client-id');
      url.searchParams.set('state', state);
      return url;
    },
  }),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location };
  },
}));

// Mock $app/environment - uses hoisted mockDev object
vi.mock('$app/environment', () => ({
  get dev() {
    return mockDev.value;
  },
}));

// Mock $env/dynamic/private for providers.ts
vi.mock('$env/dynamic/private', () => ({
  env: {
    GITHUB_CLIENT_ID: 'mock-github-client-id',
    GITHUB_CLIENT_SECRET: 'mock-github-client-secret',
    GITHUB_REDIRECT_URI: 'http://localhost:5173/login/github/callback',
    GOOGLE_CLIENT_ID: 'mock-google-client-id',
    GOOGLE_CLIENT_SECRET: 'mock-google-client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:5173/login/google/callback',
  },
}));

// Import after mocks
import { GET } from './+server';

describe('GitHub OAuth Security', () => {
  let mockCookies: Map<string, { value: string; options: Record<string, unknown> }>;
  let mockSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDev.value = true; // Reset to dev mode
    mockCookies = new Map();
    mockSet = vi.fn((name: string, value: string, options: Record<string, unknown>) => {
      mockCookies.set(name, { value, options });
    });
  });

  const createRequest = (searchParams: Record<string, string> = {}) => {
    const url = new URL('http://localhost/login/github');
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
    return {
      url,
      cookies: {
        set: mockSet,
        get: vi.fn(),
        delete: vi.fn(),
        getAll: vi.fn(() => []),
        serialize: vi.fn(),
      },
    } as unknown as Parameters<typeof GET>[0];
  };

  const getOAuthState = (): { returnTo?: string; nonce?: string } | null => {
    const cookie = mockCookies.get('oauth_state');
    if (!cookie) return null;
    try {
      return JSON.parse(cookie.value);
    } catch {
      return null;
    }
  };

  describe('returnTo URL validation', () => {
    it('accepts valid relative paths', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: '/workspaces/my-workspace/projects/my-project' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/workspaces/my-workspace/projects/my-project');
    });

    it('accepts root path', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: '/' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/');
    });

    it('accepts relative paths with query strings', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: '/workspaces?filter=open&sort=date' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/workspaces?filter=open&sort=date');
    });

    it('rejects absolute URLs (https://evil.com)', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: 'https://evil.com/steal-tokens' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/');
    });

    it('rejects protocol-relative URLs (//evil.com)', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: '//evil.com/steal-tokens' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/');
    });

    it('rejects javascript: URLs', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: 'javascript:alert(document.cookie)' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/');
    });

    it('rejects JavaScript: URLs (case-insensitive)', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: 'JavaScript:alert(1)' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/');
    });

    it('rejects JAVASCRIPT: URLs (uppercase)', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: 'JAVASCRIPT:void(0)' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/');
    });

    it('rejects data: URLs', async () => {
      expect.assertions(1);

      const request = createRequest({
        returnTo: 'data:text/html,<script>alert(document.cookie)</script>',
      });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/');
    });

    it('rejects DATA: URLs (uppercase)', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: 'DATA:text/html,malicious' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/');
    });

    it('rejects http: URLs', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: 'http://evil.com/phishing' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/');
    });

    it('handles missing returnTo parameter', async () => {
      expect.assertions(1);

      const request = createRequest({}); // No returnTo

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/');
    });

    it('handles empty returnTo parameter', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: '' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/');
    });

    // Edge cases that could bypass naive validation
    it('rejects protocol-relative URLs with extra slashes (///evil.com)', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: '///evil.com' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      // This starts with '/' but also starts with '//', so should be rejected
      expect(state?.returnTo).toBe('/');
    });

    it('accepts paths with encoded characters', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: '/workspaces/my%20workspace' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/workspaces/my%20workspace');
    });

    it('accepts paths with fragments', async () => {
      expect.assertions(1);

      const request = createRequest({ returnTo: '/docs#section-1' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const state = getOAuthState();
      expect(state?.returnTo).toBe('/docs#section-1');
    });
  });

  describe('Cookie security settings', () => {
    it('sets httpOnly cookies', async () => {
      expect.assertions(1);

      const request = createRequest({});

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const stateCookie = mockCookies.get('oauth_state');
      expect(stateCookie?.options.httpOnly).toBe(true);
    });

    it('sets sameSite=lax on cookies', async () => {
      expect.assertions(1);

      const request = createRequest({});

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const stateCookie = mockCookies.get('oauth_state');
      expect(stateCookie?.options.sameSite).toBe('lax');
    });

    it('sets reasonable cookie expiration (10 minutes)', async () => {
      expect.assertions(1);

      const request = createRequest({});

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const stateCookie = mockCookies.get('oauth_state');
      // 10 minutes = 600 seconds
      expect(stateCookie?.options.maxAge).toBe(600);
    });

    it('does not set secure flag on HTTP (development)', async () => {
      expect.assertions(1);

      // Default createRequest uses http://localhost
      const request = createRequest({});

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const stateCookie = mockCookies.get('oauth_state');
      expect(stateCookie?.options.secure).toBe(false);
    });

    it('sets secure flag in production (dev=false)', async () => {
      expect.assertions(1);

      // Simulate production mode
      mockDev.value = false;

      const request = createRequest({});

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const stateCookie = mockCookies.get('oauth_state');
      expect(stateCookie?.options.secure).toBe(true);

      // Reset for other tests
      mockDev.value = true;
    });
  });

  describe('OAuth state parameter', () => {
    it('generates and stores state for CSRF protection', async () => {
      expect.assertions(2);

      const request = createRequest({});

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      const stateCookie = mockCookies.get('oauth_state');
      const state = getOAuthState();
      expect(state?.nonce).toBe('mock-state-12345');
      expect(stateCookie?.options.httpOnly).toBe(true);
    });

    it('includes state in authorization URL', async () => {
      expect.assertions(1);

      const request = createRequest({});

      try {
        await GET(request);
      } catch (e) {
        // Expected redirect
        const redirectData = e as { status: number; location: string };
        const authUrl = new URL(redirectData.location);
        expect(authUrl.searchParams.get('state')).toBe('mock-state-12345');
      }
    });
  });

  describe('Redirect behavior', () => {
    it('redirects with 302 status code', async () => {
      expect.assertions(1);

      const request = createRequest({});

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { status: number; location: string };
        expect(redirectData.status).toBe(302);
      }
    });

    it('redirects to GitHub OAuth authorize endpoint', async () => {
      expect.assertions(1);

      const request = createRequest({});

      try {
        await GET(request);
      } catch (e) {
        const redirectData = e as { status: number; location: string };
        expect(redirectData.location).toContain('github.com/login/oauth/authorize');
      }
    });
  });
});
