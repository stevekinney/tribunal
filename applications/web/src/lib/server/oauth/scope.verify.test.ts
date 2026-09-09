import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';
import { runWithDatabase } from '$lib/server/database';
import { user } from '@tribunal/database/schema';
import { hashWithSha256 } from '$lib/server/encryption';
import { mcpBaseUrl, mcpIssuer, mcpResourceUrl } from '$lib/server/oauth/configuration';
import { tribunalScopeVocabulary } from '$lib/server/mcp/scope-vocabulary';
import { tribunalOAuthScopeConfiguration } from '$lib/server/oauth/scopes';
import type { AuthenticatedApplicationUser } from '$lib/server/auth/neon-session';

/**
 * Verifies that the library enforces *Tribunal's* injected scope vocabulary at
 * the authorize endpoint, through the mounted surface (TRI-85). Tribunal does
 * not implement scope rejection — the library does — but Tribunal supplies the
 * vocabulary and the registry-derived supported set the rejection is measured
 * against, and these tests prove the library consults that injected set rather
 * than its own demo default.
 *
 * The distinction TRI-85 exists to catch is a quiet one: the authorize code
 * path runs and the check appears to execute, but against the wrong vocabulary.
 * So the "consults Tribunal's vocabulary" test pairs a Tribunal-only scope
 * granted with a Protokit-demo scope rejected — a suite that only asserts a bad
 * scope is rejected passes just as well against a library validating the wrong
 * set.
 *
 * Only the valid authorize GET reaches `resolveUserProfile`, so those run inside
 * `runWithDatabase`; a scope rejection short-circuits before that read and needs
 * no wrapper. Constants derive from the mounted configuration so the suite
 * tracks MCP_BASE_URL (see authorize.verify.test.ts).
 */

const BASE = mcpBaseUrl.origin;
const ISSUER = mcpIssuer;
const RESOURCE = mcpResourceUrl.href;
const CLIENT_ID = 'scope-verify-client';
const REDIRECT_URI = 'https://client.example/callback';
// A valid PKCE S256 challenge shape (43 base64url chars). These tests never
// exchange the code, so only its shape matters at authorize/approve time.
const CODE_CHALLENGE = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

// The five production scopes documentation/mcp-scopes.md settles as Tribunal's
// vocabulary. conformance:read is a sixth, conformance-only scope the document
// counts separately and the registry-derived supported set excludes.
const FIVE_PRODUCTION_SCOPES = [
  'repositories:read',
  'pull_requests:read',
  'reviews:read',
  'review_findings:read',
  'cost_events:read',
] as const;
// A scope from Protokit's demo vocabulary (index.js templateScopeVocabulary)
// that Tribunal does not define — the lever that proves the injected set, not a
// library default, is what authorize validates against.
const PROTOKIT_DEMO_SCOPE = 'profile:read';

const SCOPES_DOC = readFileSync(
  fileURLToPath(new URL('../../../../../../documentation/mcp-scopes.md', import.meta.url)),
  'utf-8',
);

/**
 * Parses the canonical scope table in documentation/mcp-scopes.md, splitting its
 * rows into the production scopes and the conformance-only ones by the second
 * column. A whole-file substring check would pass against a renamed scope whose
 * old name still appears in the surrounding discussion, and could not detect an
 * added production scope; parsing the authoritative table catches both.
 */
function documentedScopes(): { production: string[]; conformanceOnly: string[] } {
  const production: string[] = [];
  const conformanceOnly: string[] = [];
  // Capture whatever the first cell's code span holds — not a restricted scope
  // grammar — so a documented scope with other characters (e.g. issues-v2:read)
  // is still parsed and still checked against the injected set.
  const rowPattern = /^\|\s*`([^`]+)`\s*\|([^|]*)\|/gm;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(SCOPES_DOC)) !== null) {
    const scope = match[1]!;
    if (/conformance-only/i.test(match[2]!)) conformanceOnly.push(scope);
    else production.push(scope);
  }
  return { production, conformanceOnly };
}

let fixture: McpMountFixture;
let applicationUser: AuthenticatedApplicationUser;

beforeAll(async () => {
  fixture = await setupMcpMountFixture();
  const [row] = await fixture.database.db
    .insert(user)
    .values({ username: 'scope-user', email: 'scope@example.com', name: 'Scope User' })
    .returning();
  applicationUser = {
    id: row!.id,
    username: row!.username,
    name: row!.name,
    avatarUrl: row!.avatarUrl,
    email: row!.email,
    isPlatformAdministrator: row!.isPlatformAdministrator,
  };
  await fixture.stores.clients.register({
    clientId: CLIENT_ID,
    clientSecretHash: null,
    clientName: 'Scope Verify Client',
    clientType: 'public',
    tokenEndpointAuthMethod: 'none',
    applicationType: 'native',
    redirectUris: [REDIRECT_URI],
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    clientIdMetadataUrl: null,
    clientSecretExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

afterAll(async () => {
  await fixture.dispose();
});

/** Builds an authorize URL; `scope: null` omits the parameter entirely. */
function authorizeUrl(overrides: Record<string, string | null> = {}): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: 'S256',
    resource: RESOURCE,
    scope: 'repositories:read',
    state: 'xyz',
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return `${BASE}/oauth/authorize?${params.toString()}`;
}

/** A valid authorize GET (reaches resolveUserProfile) with the app db routed to PGlite. */
function getAuthorize(url: string): Promise<Response> {
  return runWithDatabase(fixture.database.db as never, () =>
    fixture.handle(new Request(url), { user: applicationUser }),
  );
}

function extractField(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`name="${escaped}"[^>]*\\bvalue="([^"]*)"`));
  if (!match) throw new Error(`field ${name} not found in consent HTML`);
  return match[1]!;
}

/** Drives a valid authorize GET + approve and returns the granted scope recorded on the issued code. */
async function grantedScopeFor(url: string): Promise<string[]> {
  const consent = await getAuthorize(url);
  expect(consent.status).toBe(200);
  const html = await consent.text();
  const transactionId = extractField(html, 'transaction_id');
  const csrfToken = extractField(html, 'csrf_token');
  const approve = await fixture.handle(
    new Request(`${BASE}/oauth/authorize/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'same-origin',
      },
      body: `transaction_id=${transactionId}&csrf_token=${csrfToken}`,
    }),
    { user: applicationUser },
  );
  expect(approve.status).toBe(302);
  const code = new URL(approve.headers.get('location')!).searchParams.get('code')!;
  const stored = await fixture.stores.codes.findByHash(hashWithSha256(code));
  // The granted scope is what the code carries — canonicalized, space-joined.
  return (stored?.scope ?? '').split(' ').filter(Boolean).sort();
}

/** Runs an authorize GET expected to reject before consent, returning the error redirect's params. */
async function rejectionFor(url: string): Promise<URLSearchParams> {
  const response = await fixture.handle(new Request(url), { user: applicationUser });
  expect(response.status).toBe(302);
  return new URL(response.headers.get('location')!).searchParams;
}

describe('scope vocabulary — the injected supported set matches the documented five (AC3)', () => {
  it('exposes exactly the five production scopes as the supported set, conformance excluded', () => {
    expect([...tribunalOAuthScopeConfiguration.supportedScopes].sort()).toEqual(
      [...FIVE_PRODUCTION_SCOPES].sort(),
    );
    expect(tribunalOAuthScopeConfiguration.supportedScopes).not.toContain('conformance:read');
  });

  it('carries conformance:read in the full vocabulary but not the supported set', () => {
    expect([...tribunalScopeVocabulary.scopes].sort()).toEqual(
      [...FIVE_PRODUCTION_SCOPES, 'conformance:read'].sort(),
    );
  });

  it('matches the documented scope table exactly — the doc is authoritative', () => {
    const documented = documentedScopes();
    // The injected supported set equals the doc's production scopes exactly, by
    // name: an added, removed, or renamed production scope in the doc fails here.
    expect([...tribunalOAuthScopeConfiguration.supportedScopes].sort()).toEqual(
      [...documented.production].sort(),
    );
    // The doc marks conformance:read (and only it) as conformance-only.
    expect(documented.conformanceOnly).toEqual(['conformance:read']);
    // Anchor the current five so a deliberate vocabulary change updates this test
    // rather than passing silently against a doc-and-code drift.
    expect([...documented.production].sort()).toEqual([...FIVE_PRODUCTION_SCOPES].sort());
  });
});

describe("scope enforcement — the library consults Tribunal's vocabulary, not a default (AC2)", () => {
  it("grants a Tribunal scope that is absent from Protokit's demo set", async () => {
    const granted = await grantedScopeFor(authorizeUrl({ scope: 'repositories:read' }));
    expect(granted).toEqual(['repositories:read']);
  });

  it('rejects a Protokit demo scope Tribunal does not define with invalid_scope', async () => {
    const params = await rejectionFor(authorizeUrl({ scope: PROTOKIT_DEMO_SCOPE }));
    expect(params.get('error')).toBe('invalid_scope');
    expect(params.get('iss')).toBe(ISSUER);
  });
});

describe('scope enforcement — conformance:read is unobtainable (AC4)', () => {
  it('rejects a request for the conformance-only scope with invalid_scope', async () => {
    // conformance:read is a valid vocabulary name (isScope true) but is not in
    // the registry-derived supported set, so authorize rejects it.
    const params = await rejectionFor(authorizeUrl({ scope: 'conformance:read' }));
    expect(params.get('error')).toBe('invalid_scope');
    expect(params.get('iss')).toBe(ISSUER);
  });

  it('rejects conformance:read even when mixed with a supported scope', async () => {
    // Every scope in the request must be supported — an implementation that
    // accepted a request with any one valid scope would let conformance:read
    // ride along into the grant. The mix must still be rejected wholesale.
    const params = await rejectionFor(
      authorizeUrl({ scope: 'repositories:read conformance:read' }),
    );
    expect(params.get('error')).toBe('invalid_scope');
  });
});

describe('scope enforcement — the four policy behaviours hold through the mount (AC5)', () => {
  it('rejects an unsupported scope with invalid_scope', async () => {
    const params = await rejectionFor(authorizeUrl({ scope: 'not-a-real-scope' }));
    expect(params.get('error')).toBe('invalid_scope');
  });

  it('grants the full supported set when scope is omitted', async () => {
    const granted = await grantedScopeFor(authorizeUrl({ scope: null }));
    expect(granted).toEqual([...FIVE_PRODUCTION_SCOPES].sort());
  });

  it('rejects a present-but-empty scope, distinct from an omitted one', async () => {
    const params = await rejectionFor(authorizeUrl({ scope: '' }));
    expect(params.get('error')).toBe('invalid_scope');
  });

  it('grants an explicit non-empty list exactly as requested, never expanded', async () => {
    const granted = await grantedScopeFor(
      authorizeUrl({ scope: 'repositories:read reviews:read' }),
    );
    expect(granted).toEqual(['repositories:read', 'reviews:read'].sort());
  });

  it('grants an explicit list that omits the baseline scope without re-adding it', async () => {
    // Every other granted-scope request here includes repositories:read, so a
    // regression that silently added it to every grant would pass unnoticed.
    // Request only reviews:read and assert repositories:read is absent.
    const granted = await grantedScopeFor(authorizeUrl({ scope: 'reviews:read' }));
    expect(granted).toEqual(['reviews:read']);
    expect(granted).not.toContain('repositories:read');
  });
});
