import { describe, expect, it } from 'vitest';
import { renderConsent } from './consent';

const prompt = {
  mode: 'prompt' as const,
  transactionId: 'txn-123',
  csrfToken: 'csrf-456',
  redirectUri: 'https://client.example/callback',
  client: { id: 'client-1', name: 'Example Client' },
  requester: {
    id: '7',
    email: 'octo@example.com',
    name: 'Octo Cat',
    image: null,
    role: 'user' as const,
  },
  scopes: [
    { scope: 'repositories:read', description: 'Read your connected repositories.' },
    { scope: 'pull_requests:read', description: 'Read pull request details.' },
  ],
};

// `renderConsent` is typed `Response | Promise<Response>`; await normalizes it.
const renderHtml = async (p: Parameters<typeof renderConsent>[0]): Promise<string> =>
  (await renderConsent(p)).text();

describe('renderConsent (TRI-40)', () => {
  it('renders the prompt as a 200 HTML response with the AC5 security headers', async () => {
    const response = await renderConsent(prompt);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    // No scripts, and the page stays unframeable.
    expect(csp).not.toContain('script-src');
    expect(csp).toContain("frame-ancestors 'none'");
    // `form-action` is intentionally absent: Chromium enforces it against the
    // redirect target, which would block the mount's 302 to a cross-origin client
    // redirect_uri. CSRF is enforced by the transaction-bound csrf_token instead.
    expect(csp).not.toContain('form-action');
  });

  it('ships zero client-side JavaScript (AC4)', async () => {
    const html = await renderHtml(prompt);
    // No script tags, no hydration data, no inline event handlers.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('renders the client name, requester, redirect, and each scope description verbatim (AC6)', async () => {
    const html = await renderHtml(prompt);
    expect(html).toContain('Example Client');
    expect(html).toContain('octo@example.com');
    expect(html).toContain('https://client.example/callback');
    for (const entry of prompt.scopes) {
      expect(html).toContain(entry.scope);
      expect(html).toContain(entry.description);
    }
  });

  it('posts the transaction id and CSRF token as hidden fields, never a URL', async () => {
    const html = await renderHtml(prompt);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*value="txn-123"/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*value="csrf-456"/);
    expect(html).toContain('action="/oauth/authorize/approve"');
    expect(html).toContain('action="/oauth/authorize/deny"');
  });

  it('carries an inline <style> element rather than an external stylesheet request', async () => {
    const html = await renderHtml(prompt);
    // The style wiring is present and no <link rel=stylesheet> is emitted, so the
    // page is self-contained. The actual Cinder CSS is inlined at build time via
    // Vite `?inline` (which returns an empty string under vitest, so its content
    // is verified against the real build, not here).
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<link[^>]*rel="stylesheet"/i);
  });

  it('escapes an attacker-shaped client name rather than injecting markup', async () => {
    const html = await renderHtml({
      ...prompt,
      client: { id: 'x', name: '<img src=x onerror=alert(1)>' },
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('renders the error mode as a 400', async () => {
    const response = await renderConsent({ mode: 'error', error: 'Unknown OAuth client.' });
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('Unknown OAuth client.');
    expect(html).not.toMatch(/<script/i);
  });
});
