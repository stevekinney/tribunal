import { render } from 'svelte/server';
import { authorizeFormParameterNames, type RenderConsent } from '@lostgradient/mcp/oauth';
// Cinder's stylesheet imported as a string (Vite `?inline`) so it can be inlined
// into this standalone page. The consent screen is rendered by the mount seam,
// outside the SvelteKit layout that normally links Cinder's CSS, so the styles
// have to travel with the page — and inlining keeps it zero-request and
// script-free (TRI-40 AC4). Uses the all-in `styles/all` bundle, not the base
// `styles` entry: the base bundle carries only tokens + foundation, so the
// per-component rules (`.cinder-card`, `.cinder-button`, `.cinder-stack`) that
// give this page its layout and chrome are absent from it. `styles/all` folds in
// `components.css` and the utilities layer.
import cinderStyles from '@lostgradient/cinder/styles/all?inline';
import ConsentPrompt from './consent-prompt.svelte';
import ConsentError from './consent-error.svelte';

/**
 * Renders the OAuth consent screen as a self-contained, zero-JavaScript HTML
 * `Response` (TRI-40). The mount owns `/oauth/authorize` and calls this seam
 * directly rather than routing to SvelteKit, so the screen is server-rendered
 * from Svelte + Cinder components via `svelte/server` and returned inline — no
 * hand-rolled markup, and Protokit's `lib/html-response.ts` is not ported (AC2).
 *
 * Approve and deny post the transaction id and one-time CSRF token back as
 * hidden fields (never in a URL). The client display name is already validated
 * by the library's `isValidClientName` before it reaches the presentation
 * (dynamic registration refines it, and the authorize handler substitutes a
 * generic name when it fails), so an attacker-controlled name never renders
 * here (AC7, verified in `client-name-validation.test.ts`).
 */

const [TRANSACTION_ID_FIELD, CSRF_TOKEN_FIELD] = authorizeFormParameterNames;

// Deny scripts outright and keep the page unframeable. The inlined `<style>`
// requires `style-src 'unsafe-inline'`.
//
// `form-action` is deliberately omitted. Chromium (unlike Firefox) enforces
// `form-action` against the *redirect target* of a form submission, not just the
// initial POST URL. The consent forms POST to the mount's own origin, but the
// mount answers with a 302 to the OAuth client's `redirect_uri` — which for every
// real client is a different origin (a native MCP client's own loopback port, a
// hosted client's HTTPS host). A `form-action 'self'` would let the POST through
// and then silently block that redirect in Chrome, breaking consent for all
// clients. The client set is registered dynamically, so it cannot be enumerated
// into an allowlist. CSRF on approve/deny is enforced by the mount's
// transaction-bound `csrf_token` (a hidden field), not by this directive.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function htmlDocument(rendered: { head: string; body: string }): string {
  return (
    '<!doctype html>' +
    '<html lang="en">' +
    '<head>' +
    '<meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    `<style>${cinderStyles}</style>` +
    rendered.head +
    '</head>' +
    `<body>${rendered.body}</body>` +
    '</html>'
  );
}

function htmlResponse(rendered: { head: string; body: string }, status: number): Response {
  return new Response(htmlDocument(rendered), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-frame-options': 'DENY',
      'content-security-policy': CONTENT_SECURITY_POLICY,
    },
  });
}

export const renderConsent: RenderConsent = (presentation) => {
  if (presentation.mode === 'error') {
    return htmlResponse(render(ConsentError, { props: { error: presentation.error } }), 400);
  }

  const { transactionId, csrfToken, redirectUri, client, requester, scopes } = presentation;

  const rendered = render(ConsentPrompt, {
    props: {
      transactionIdField: TRANSACTION_ID_FIELD,
      csrfTokenField: CSRF_TOKEN_FIELD,
      transactionId,
      csrfToken,
      clientName: client.name,
      requesterLabel: requester.email || requester.name,
      redirectUri,
      scopes,
    },
  });

  return htmlResponse(rendered, 200);
};
