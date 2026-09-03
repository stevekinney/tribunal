import { authorizeFormParameterNames, type RenderConsent } from '@lostgradient/mcp/oauth';

/**
 * Renders the OAuth consent screen as a self-contained HTML `Response`.
 *
 * The mount intercepts `/oauth/*` itself, so this seam returns the page
 * directly rather than through a SvelteKit route. The prompt posts the
 * transaction id and CSRF token back to `/oauth/approve` (or `/oauth/deny`)
 * using the library's own field names, so the values never travel in a URL.
 * Every interpolated value (client name, requester, scope copy) is
 * HTML-escaped — the client name in particular is attacker-controlled via
 * dynamic registration.
 *
 * This is deliberately minimal, accessible markup; TRI-40 replaces it with the
 * Cinder-styled screen. The scope descriptions come from Tribunal's scope
 * vocabulary, shown verbatim as the consent copy.
 */

const [TRANSACTION_ID_FIELD, CSRF_TOKEN_FIELD] = authorizeFormParameterNames;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function htmlResponse(body: string, status: number): Response {
  return new Response(`<!doctype html>\n${body}`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function hiddenField(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`;
}

function page(title: string, main: string): string {
  return `<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title></head><body><main>${main}</main></body></html>`;
}

export const renderConsent: RenderConsent = (presentation) => {
  if (presentation.mode === 'error') {
    return htmlResponse(
      page(
        'Authorization error',
        `<h1>Authorization error</h1><p>${escapeHtml(presentation.error)}</p>`,
      ),
      400,
    );
  }

  const { transactionId, csrfToken, client, requester, scopes } = presentation;
  const hidden = `${hiddenField(TRANSACTION_ID_FIELD, transactionId)}${hiddenField(CSRF_TOKEN_FIELD, csrfToken)}`;

  const scopeItems = scopes
    .map(
      (entry) =>
        `<li><strong>${escapeHtml(entry.scope)}</strong><span>${escapeHtml(entry.description)}</span></li>`,
    )
    .join('');

  const body = page(
    'Authorize access',
    `<h1>Authorize access</h1>
<p><strong>${escapeHtml(client.name)}</strong> is requesting access to your Tribunal account (${escapeHtml(requester.email || requester.name)}).</p>
<p>It will be able to:</p>
<ul>${scopeItems}</ul>
<form method="post" action="/oauth/approve">${hidden}<button type="submit">Approve</button></form>
<form method="post" action="/oauth/deny">${hidden}<button type="submit">Deny</button></form>`,
  );

  return htmlResponse(body, 200);
};
