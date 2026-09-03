import { describe, expect, it } from 'vitest';
import type { ConsentPresentation } from '@lostgradient/mcp/oauth';
import { renderConsent } from './consent';

describe('renderConsent', () => {
  it('renders an escaped error page for the error mode', async () => {
    const response = await renderConsent({ mode: 'error', error: 'bad <thing>' });
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Authorization error');
    expect(html).toContain('bad &lt;thing&gt;');
  });

  it('renders the consent prompt with hidden fields, scopes, and both forms', async () => {
    const presentation: ConsentPresentation = {
      mode: 'prompt',
      transactionId: 'txn-1',
      csrfToken: 'csrf-1',
      redirectUri: 'https://client.example/cb',
      client: { id: 'client-1', name: 'My <App>' },
      requester: { id: '1', email: 'user@example.com', name: 'User', image: null, role: 'user' },
      scopes: [{ scope: 'repositories:read', description: 'Read your repositories' }],
    };
    const response = await renderConsent(presentation);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('name="transaction_id" value="txn-1"');
    expect(html).toContain('name="csrf_token" value="csrf-1"');
    expect(html).toContain('action="/oauth/approve"');
    expect(html).toContain('action="/oauth/deny"');
    expect(html).toContain('repositories:read');
    expect(html).toContain('Read your repositories');
    expect(html).toContain('My &lt;App&gt;');
    expect(html).toContain('user@example.com');
  });
});
