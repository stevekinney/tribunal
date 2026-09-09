import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSupportedScopes } from '@lostgradient/mcp';
import {
  handleOauthAuthorizationMetadataGet,
  type OAuthRequestContext,
} from '@lostgradient/mcp/oauth';
import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';
import {
  mcpBaseUrl,
  mcpIssuer,
  mcpResourceUrl,
  tribunalOAuthDiscoveryConfiguration,
} from '$lib/server/oauth/configuration';
import { tribunalMcpRegistry } from '$lib/server/mcp/registry';

/**
 * Verifies the three OAuth discovery documents resolve through Tribunal's real
 * hook chain (TRI-39). The documents are composed entirely by `@lostgradient/mcp`
 * from Tribunal's issuer, base URL, resource, server name, and registry; these
 * tests prove they are *served* at Tribunal's origin — a routing question, not a
 * handler one — because a discovery document that 404s is indistinguishable, to
 * every MCP client, from a server that does not implement OAuth.
 *
 * Serving mechanism: the mounted `handle` chain, not a SvelteKit filesystem
 * route. Tribunal has no `.well-known` route on disk (a dot-prefixed directory a
 * filesystem router routinely ignores); the mount owns these paths. The fixture
 * routes through the same MCP identity + mount handles hooks.server.ts composes,
 * with a plain 404 for anything the mount passes through — so a 200 here proves
 * the mount served it and a 404 proves it fell through, exactly the distinction
 * AC3 asks for. `respondWithJsonForApiEndpoints` cannot apply: its `isApiRoute`
 * matches only `/api` and `/api/*`, never `/.well-known/*`.
 *
 * Discovery is unauthenticated and never reaches `resolveUserProfile`, so no
 * `runWithDatabase` wrapper is needed. Constants derive from the mounted
 * configuration so the suite tracks MCP_BASE_URL.
 */

const BASE = mcpBaseUrl.origin;
const ISSUER = mcpIssuer;
const RESOURCE = mcpResourceUrl.href;
const SUPPORTED_SCOPES = [...getSupportedScopes(tribunalMcpRegistry)].sort();

const AUTHORIZATION_SERVER_PATH = '/.well-known/oauth-authorization-server';
const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';
const PROTECTED_RESOURCE_MCP_PATH = '/.well-known/oauth-protected-resource/mcp';

let fixture: McpMountFixture;

beforeAll(async () => {
  fixture = await setupMcpMountFixture();
});

afterAll(async () => {
  await fixture.dispose();
});

async function getDocument(
  path: string,
): Promise<{ status: number; contentType: string | null; body: Record<string, unknown> }> {
  const response = await fixture.handle(new Request(`${BASE}${path}`));
  const contentType = response.headers.get('content-type');
  const status = response.status;
  const body =
    status === 200 && (contentType ?? '').includes('application/json')
      ? ((await response.json()) as Record<string, unknown>)
      : {};
  return { status, contentType, body };
}

function sortedScopes(value: unknown): string[] {
  // A clear failure if a document ever omits scopes_supported or returns a
  // non-array, rather than a bare TypeError from spreading undefined.
  expect(Array.isArray(value)).toBe(true);
  return [...(value as string[])].sort();
}

describe('discovery — the authorization-server document resolves with correct content (AC1, AC4-6, AC7)', () => {
  it('serves 200 application/json with library-composed content at Tribunal origin', async () => {
    const { status, contentType, body } = await getDocument(AUTHORIZATION_SERVER_PATH);
    expect(status).toBe(200);
    expect(contentType).toContain('application/json');
    // Content Tribunal supplies (issuer/base URL) composed by the library.
    expect(body.issuer).toBe(ISSUER);
    expect(body.authorization_endpoint).toBe(`${BASE}/oauth/authorize`);
    expect(body.token_endpoint).toBe(`${BASE}/oauth/token`);
    expect(body.registration_endpoint).toBe(`${BASE}/oauth/register`);
    expect(body.revocation_endpoint).toBe(`${BASE}/oauth/revoke`);
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
    expect(body.authorization_response_iss_parameter_supported).toBe(true);
    // AC5: how Codex CLI's --oauth-client-registration auto selects CIMD.
    expect(body.client_id_metadata_document_supported).toBe(true);
    // AC4: scopes_supported is the registry-derived set, not a hand list.
    expect(sortedScopes(body.scopes_supported)).toEqual(SUPPORTED_SCOPES);
  });
});

describe('discovery — the protected-resource documents resolve with correct content (AC1, AC4, AC6, AC7)', () => {
  it('serves the protected-resource document with resource, issuer, and server name', async () => {
    const { status, contentType, body } = await getDocument(PROTECTED_RESOURCE_PATH);
    expect(status).toBe(200);
    expect(contentType).toContain('application/json');
    expect(body.resource).toBe(RESOURCE);
    expect(body.authorization_servers).toEqual([ISSUER]);
    expect(body.resource_name).toBe(tribunalOAuthDiscoveryConfiguration.serverName);
    expect(sortedScopes(body.scopes_supported)).toEqual(SUPPORTED_SCOPES);
  });

  it('serves the /mcp protected-resource document naming the served protocol version', async () => {
    const { status, contentType, body } = await getDocument(PROTECTED_RESOURCE_MCP_PATH);
    expect(status).toBe(200);
    expect(contentType).toContain('application/json');
    expect(body.resource).toBe(RESOURCE);
    expect(body.authorization_servers).toEqual([ISSUER]);
    // AC6: names the served default revision.
    expect(body.mcp_protocol_version).toBe(tribunalOAuthDiscoveryConfiguration.mcpProtocolVersion);
    expect(sortedScopes(body.scopes_supported)).toEqual(SUPPORTED_SCOPES);
  });
});

describe("discovery — served by the mount, not by SvelteKit's fallback 404 (AC2, AC3)", () => {
  it('returns the ordinary 404 for a well-known path the mount does not own', async () => {
    // The mount routes exactly the three documented paths; anything else falls
    // through the chain to SvelteKit's ordinary 404. A 404 here alongside 200s
    // above proves the mount serves the specific three rather than a catch-all,
    // and that the three are not themselves the fallback.
    const { status } = await getDocument('/.well-known/oauth-authorization-server-nope');
    expect(status).toBe(404);
  });

  it('serves all three documented paths (none is the fallback 404)', async () => {
    for (const path of [
      AUTHORIZATION_SERVER_PATH,
      PROTECTED_RESOURCE_PATH,
      PROTECTED_RESOURCE_MCP_PATH,
    ]) {
      const { status } = await getDocument(path);
      expect(status).toBe(200);
    }
  });
});

describe('discovery — scopes_supported derives mechanically from the registry (AC4)', () => {
  it('reflects an added registry scope rather than a hand-maintained list', () => {
    // Add a tool declaring a scope Tribunal's registry does not have, and observe
    // it appear in the authorization-server document the library composes — the
    // set is walked from the registry, never restated. (Mirrors registry.test.ts'
    // minimal-tool augmentation; getSupportedScopes only reads requiredScope.)
    // Clone a real tool and override its name and scope so the appended entry
    // keeps a valid tool shape (getSupportedScopes reads requiredScope, but this
    // stays correct if metadata code starts touching other fields). Only the
    // out-of-vocabulary scope literal needs a cast.
    const sampleTool = tribunalMcpRegistry.tools[0]!;
    const probeTool = {
      ...sampleTool,
      name: 'discovery_probe',
      requiredScope: 'discovery_probe:read' as (typeof sampleTool)['requiredScope'],
    };
    const augmentedRegistry = {
      ...tribunalMcpRegistry,
      tools: [...tribunalMcpRegistry.tools, probeTool],
    };
    const request = new Request(`${BASE}${AUTHORIZATION_SERVER_PATH}`);
    const context: OAuthRequestContext = {
      request,
      requestUrl: new URL(request.url),
      requestId: 'discovery-derivation',
      identity: null,
    };
    const response = handleOauthAuthorizationMetadataGet(
      context,
      tribunalOAuthDiscoveryConfiguration,
      augmentedRegistry,
    );
    return response.json().then((body: Record<string, unknown>) => {
      const scopes = body.scopes_supported as string[];
      expect(scopes).toContain('discovery_probe:read');
      for (const scope of SUPPORTED_SCOPES) expect(scopes).toContain(scope);
    });
  });
});
