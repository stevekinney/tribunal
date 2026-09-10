import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import { createE2ESession } from '../helpers';

/**
 * TRI-40: the OAuth consent screen, driven end to end in a real browser. This is
 * what the unit tests cannot show — that the zero-JavaScript, SSR'd Cinder screen
 * actually navigates on Approve and Deny with scripting doing nothing (the forms
 * are native POSTs). The MCP mount is enabled in the E2E preview server
 * (playwright.config.ts) and its OAuth stores run against the per-worker PGlite,
 * so registration, authorize, and approve/deny all hit the same database.
 *
 * The client's redirect_uri is a *real* loopback server on a different port than
 * the preview server, so it is a different origin. That is the shape of every
 * real client — a native MCP client on its own loopback port, or a hosted client
 * on another host — and only a cross-origin redirect exercises two properties a
 * same-origin redirect silently passes:
 *
 *   - The consent CSP must not block the 302 to the client. Chromium enforces
 *     `form-action` against the redirect *target*, so a `form-action 'self'`
 *     would let the POST through and then refuse the redirect — the request below
 *     would never reach the callback server and `waitForURL` would time out.
 *   - The `same-origin` referrer policy must drop the Referer on that cross-origin
 *     redirect, so the client never sees the authorize URL's transaction id. The
 *     callback server records the Referer it received to prove it is absent.
 *
 * Both were latent production bugs a same-origin redirect would not have caught;
 * keep this shape cross-origin.
 */

// A valid PKCE S256 challenge (only the challenge is needed to reach consent and
// approve; the verifier is used at token exchange, which this flow does not run).
const CODE_CHALLENGE = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CALLBACK_PATH = '/oauth-e2e-callback';

/** The most recent request the stand-in client callback server received. */
let lastCallback: { path: string; referer: string | undefined } | null = null;
let callbackServer: Server;
let callbackPort: number;

/** Reset/read via functions so a test's `null` reset does not narrow the module var. */
function resetLastCallback(): void {
  lastCallback = null;
}
function lastCallbackReferer(): string | undefined {
  return lastCallback?.referer;
}

// A real loopback client on an ephemeral port (guaranteed a different origin than
// the preview server, and no risk of a fixed-port collision). Records what the
// browser sent so the redirect lands cleanly and the Referer can be inspected.
test.beforeAll(async () => {
  callbackServer = createServer((request, response) => {
    lastCallback = { path: request.url ?? '', referer: request.headers.referer };
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>client callback</title>ok');
  });
  await new Promise<void>((resolve) => callbackServer.listen(0, '127.0.0.1', resolve));
  const address = callbackServer.address();
  callbackPort = typeof address === 'object' && address ? address.port : 0;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    callbackServer.close((error) => (error ? reject(error) : resolve())),
  );
});

function callbackUrl(): string {
  return `http://127.0.0.1:${callbackPort}${CALLBACK_PATH}`;
}

function authorizeUrl(baseURL: string, clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: 'S256',
    resource: new URL('/mcp', baseURL).href,
    scope: 'repositories:read',
    state: 'xyz',
  });
  return `/oauth/authorize?${params.toString()}`;
}

/** Registers a public OAuth client through the mount (shares the page's worker cookie). */
async function registerClient(
  page: import('@playwright/test').Page,
  redirectUri: string,
): Promise<string> {
  const response = await page.request.post('/oauth/register', {
    data: {
      client_name: 'E2E Consent Client',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      // A native client may use an http loopback redirect on any port (RFC 8252);
      // a web client would require HTTPS.
      application_type: 'native',
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { client_id: string };
  expect(body.client_id).toBeTruthy();
  return body.client_id;
}

test('approving the consent screen redirects back to the client with an authorization code', async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  resetLastCallback();
  await createE2ESession(page, request, testInfo);
  const redirectUri = callbackUrl();
  const clientId = await registerClient(page, redirectUri);

  await page.goto(authorizeUrl(baseURL!, clientId, redirectUri));

  // The Cinder consent screen renders (SSR, zero JS).
  await expect(page.getByRole('heading', { name: 'Authorize access' })).toBeVisible();
  await expect(page.getByText('E2E Consent Client')).toBeVisible();

  await page.getByRole('button', { name: 'Approve' }).click();

  // Native form POST -> 302 that the browser follows across origins to the client.
  await page.waitForURL(new RegExp(`^http://127\\.0\\.0\\.1:${callbackPort}${CALLBACK_PATH}\\?`));
  const url = new URL(page.url());
  expect(url.searchParams.get('code')).toBeTruthy();
  expect(url.searchParams.get('state')).toBe('xyz');
  // No Referer reached the cross-origin client (same-origin policy), so the
  // authorize URL's transaction id never leaks.
  expect(lastCallbackReferer()).toBeUndefined();
});

test('denying the consent screen redirects back to the client with access_denied', async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  resetLastCallback();
  await createE2ESession(page, request, testInfo);
  const redirectUri = callbackUrl();
  const clientId = await registerClient(page, redirectUri);

  await page.goto(authorizeUrl(baseURL!, clientId, redirectUri));
  await expect(page.getByRole('heading', { name: 'Authorize access' })).toBeVisible();

  await page.getByRole('button', { name: 'Deny' }).click();

  await page.waitForURL(new RegExp(`^http://127\\.0\\.0\\.1:${callbackPort}${CALLBACK_PATH}\\?`));
  const url = new URL(page.url());
  expect(url.searchParams.get('error')).toBe('access_denied');
  expect(url.searchParams.get('code')).toBeNull();
  expect(lastCallbackReferer()).toBeUndefined();
});
