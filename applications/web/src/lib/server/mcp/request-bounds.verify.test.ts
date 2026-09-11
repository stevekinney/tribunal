import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setupMcpMountFixture, type McpMountFixture } from '$testing/mcp/mount-fixture';
import {
  startAdapterNodeHarness,
  convertRequestThroughAdapter,
  type AdapterNodeHarness,
} from '$testing/mcp/adapter-node-harness';
import { registerOAuthClient, mintAccessToken } from '$testing/mcp/oauth-token-minting';
import { runWithDatabase } from '$lib/server/database';
import { user } from '@tribunal/database/schema';
import { mcpBaseUrl, mcpRuntimeLimits } from '$lib/server/oauth/configuration';
import { MAX_PAYLOAD_SIZE } from '@tribunal/github/webhooks/types';
import type { AuthenticatedApplicationUser } from '$lib/server/auth/neon-session';

/**
 * Verifies request-body bounding through Tribunal's mounted surface and the
 * `@sveltejs/adapter-node` backstop (TRI-48).
 *
 * Two physically distinct layers bound a body, and the tests keep them apart:
 *
 * - The per-route streaming bound lives in `@lostgradient/mcp` (`boundRequestBody`,
 *   a WHATWG-`ReadableStream` guard *inside* SvelteKit's `handle`), wired by
 *   configuration (`mcpRuntimeLimits.maximumRequestBodyBytes` = 1 MiB). It rejects
 *   with a 413 `payload_too_large`.
 * - The global backstop lives in `@sveltejs/kit/node`'s `get_raw_body`, a
 *   Node-stream guard *above* `handle`, enforcing `BODY_SIZE_LIMIT`. It rejects
 *   with a `SvelteKitError` (413).
 *
 * A fixture that calls `handle` directly sees the first but is structurally blind
 * to the second, so the adapter layer is exercised through `convertRequestThroughAdapter`,
 * which runs the genuine `getRequest`/`get_raw_body` conversion against a synthetic
 * Node request — deterministically, without a real socket's `ECONNRESET` on a body
 * rejected mid-upload, and with byte control independent of the declared length. A
 * single real-socket smoke proves the whole path serves. The backstop the suite
 * enforces is the value committed in `deployment/fly/web.toml`, not a literal.
 *
 * No bounding logic is reimplemented here (criterion 8); both bounds are the
 * library's / the adapter's, driven only by configuration.
 */

const BASE = mcpBaseUrl.origin;
const LEGACY_ERA = '2025-11-25';
const ROUTE_LIMIT = mcpRuntimeLimits.maximumRequestBodyBytes; // 1 MiB, the /mcp bound.

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../../../../..');
const webTomlPath = resolve(repositoryRoot, 'deployment/fly/web.toml');

/** Parses a `BODY_SIZE_LIMIT`-style size the way adapter-node's `parse_as_bytes` does (K/M/G = 1024). */
function parseByteSize(value: string): number {
  const multiplier: Record<string, number> = { K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 };
  const suffix = value[value.length - 1]?.toUpperCase() ?? '';
  const factor = multiplier[suffix];
  return factor ? Number(value.slice(0, -1)) * factor : Number(value);
}

/** The `BODY_SIZE_LIMIT` committed for the deployed web app, read from source of truth. */
function committedBodySizeLimit(): { raw: string; bytes: number } {
  const toml = readFileSync(webTomlPath, 'utf8');
  const match = toml.match(/^\s*BODY_SIZE_LIMIT\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error('BODY_SIZE_LIMIT is not set in deployment/fly/web.toml');
  return { raw: match[1]!, bytes: parseByteSize(match[1]!) };
}

const BACKSTOP = committedBodySizeLimit();
const OLD_DEFAULT_BYTES = parseByteSize('512K'); // adapter-node's inherited default.

/** `total` zero-bytes split into 64 KiB chunks, for streaming through the adapter conversion. */
function bytes(total: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let remaining = total;
  while (remaining > 0) {
    const size = Math.min(65_536, remaining);
    chunks.push(new Uint8Array(size));
    remaining -= size;
  }
  return chunks;
}

let fixture: McpMountFixture;
let applicationUser: AuthenticatedApplicationUser;
let reviewsToken: string;
let smokeHarness: AdapterNodeHarness;

/** Routes a Web Request through Tribunal's real mount, as the deployed hook chain does. */
function dispatchThroughMount(request: Request): Promise<Response> {
  return runWithDatabase(fixture.database.db as never, () => fixture.handle(request));
}

function lowerAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${reviewsToken}`,
    ...extra,
  };
}

type Rejection = { status: number; message: string };

/** Reads a converted request's body directly and captures the adapter's `SvelteKitError`. */
async function readExpectingAdapterRejection(request: Request): Promise<Rejection> {
  try {
    await request.arrayBuffer();
  } catch (error) {
    return {
      status: (error as { status?: number }).status ?? 0,
      message: (error as { body?: { message?: string } }).body?.message ?? String(error),
    };
  }
  throw new Error('expected the adapter to reject the body on read');
}

/** A valid legacy `initialize`, optionally padded through `params._meta` (a spec-open field) to a size. */
function initializeMessage(paddingBytes = 0): string {
  const params: Record<string, unknown> = {
    protocolVersion: LEGACY_ERA,
    capabilities: {},
    clientInfo: { name: 'tri-48-request-bounds', version: '0' },
  };
  if (paddingBytes > 0) params._meta = { 'tri48/padding': 'a'.repeat(paddingBytes) };
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params });
}

beforeAll(async () => {
  fixture = await setupMcpMountFixture();
  const [row] = await fixture.database.db
    .insert(user)
    .values({ username: 'bounds-user', email: 'bounds@example.com', name: 'Bounds User' })
    .returning();
  applicationUser = {
    id: row!.id,
    username: row!.username,
    name: row!.name,
    avatarUrl: row!.avatarUrl,
    email: row!.email,
    isPlatformAdministrator: row!.isPlatformAdministrator,
  };
  const clientId = await registerOAuthClient(fixture);
  reviewsToken = await mintAccessToken(fixture, 'reviews:read', applicationUser, clientId);
  smokeHarness = await startAdapterNodeHarness({
    base: BASE,
    bodySizeLimit: BACKSTOP.bytes,
    dispatch: dispatchThroughMount,
  });
});

afterAll(async () => {
  await smokeHarness.close();
  await fixture.dispose();
});

describe('TRI-48 AC1 — the adapter backstop is configured above the largest per-route limit', () => {
  it("sets BODY_SIZE_LIMIT in web.toml above every route's own limit", () => {
    // Both /mcp and the GitHub webhook route live under this one adapter, so the
    // backstop must clear the LARGEST of their limits — the webhook route's
    // MAX_PAYLOAD_SIZE (5 MiB), above /mcp's 1 MiB — for each route's own bound to
    // be what rejects in normal operation.
    expect(MAX_PAYLOAD_SIZE).toBeGreaterThan(ROUTE_LIMIT);
    expect(BACKSTOP.bytes).toBeGreaterThan(MAX_PAYLOAD_SIZE);
    expect(BACKSTOP.raw).toBe('6M');
  });
});

describe('TRI-48 AC1 — the backstop clears the webhook route the earlier value would have dropped', () => {
  it('admits a webhook-sized body under the committed backstop but rejects it under the old 2 MiB', async () => {
    // The /api/webhooks/github route accepts up to MAX_PAYLOAD_SIZE (5 MiB) and
    // enforces that itself. The committed backstop must let a body at that size
    // reach the route; a 2 MiB backstop — the value before this finding — would
    // have the adapter drop a 2–5 MiB delivery before the route's own bound ran.
    const admitted = await convertRequestThroughAdapter({
      base: BASE,
      path: '/api/webhooks/github',
      headers: { 'content-type': 'application/json', 'content-length': String(MAX_PAYLOAD_SIZE) },
      body: bytes(MAX_PAYLOAD_SIZE),
      bodySizeLimit: BACKSTOP.bytes,
    });
    const received = await admitted.arrayBuffer();
    expect(received.byteLength).toBe(MAX_PAYLOAD_SIZE);

    const rejectedUnderOldValue = await convertRequestThroughAdapter({
      base: BASE,
      path: '/api/webhooks/github',
      headers: { 'content-type': 'application/json', 'content-length': String(MAX_PAYLOAD_SIZE) },
      body: bytes(MAX_PAYLOAD_SIZE),
      bodySizeLimit: parseByteSize('2M'),
    });
    const rejection = await readExpectingAdapterRejection(rejectedUnderOldValue);
    expect(rejection.status).toBe(413);
    expect(rejection.message).toContain('exceeds limit');
  });
});

describe('TRI-48 — the real adapter path serves a normal request', () => {
  it('serves a valid initialize through a live adapter-node socket', async () => {
    const response = await fetch(`${smokeHarness.origin}/mcp`, {
      method: 'POST',
      headers: lowerAuthHeaders(),
      body: initializeMessage(),
    });
    expect(response.status).toBe(200);
    await response.text();
  });
});

describe('TRI-48 AC2 — the route rejects the (1 MiB, backstop] band with its own error', () => {
  it('rejects an over-route declared body with payload_too_large, surviving the adapter conversion', async () => {
    // 1.5 MiB declared content-length: over the /mcp route limit, under the 2 MiB
    // adapter backstop. The engine's bound reads the declared content-length header
    // and rejects synchronously with its own payload_too_large — and that header
    // survives the adapter's getRequest conversion intact, which is what this test
    // adds over a bare fixture call. The outcome is the same at any backstop above
    // the declared size, because the engine's pre-flight fires before the adapter's
    // body stream is read; the "not by the adapter" half of this criterion — that
    // the committed backstop does not preempt the route for traffic the route would
    // allow — is proven by the (512K, 1 MiB] discrimination below, not here.
    const declared = ROUTE_LIMIT + 524_288;
    const request = await convertRequestThroughAdapter({
      base: BASE,
      path: '/mcp',
      headers: lowerAuthHeaders({ 'content-length': String(declared) }),
      body: bytes(4096),
      bodySizeLimit: BACKSTOP.bytes,
    });
    const response = await dispatchThroughMount(request);
    const text = await response.text();
    expect(response.status).toBe(413);
    expect(text).toContain('payload_too_large');
  });
});

describe("TRI-48 AC6 — the adapter's streaming Request is served correctly within limits", () => {
  it('serves a chunked (no content-length) initialize through the mount', async () => {
    // Proves the duplex `Request` the adapter conversion produces is read and
    // answered end to end — the concern criterion 6 raises about the Node↔Web
    // conversion — rather than hanging or arriving with a consumed body.
    const request = await convertRequestThroughAdapter({
      base: BASE,
      path: '/mcp',
      headers: lowerAuthHeaders({ 'transfer-encoding': 'chunked' }),
      body: [new TextEncoder().encode(initializeMessage())],
      bodySizeLimit: BACKSTOP.bytes,
    });
    const response = await dispatchThroughMount(request);
    expect(response.status).toBe(200);
    await response.text();
  });
});

describe('TRI-48 AC2 motivation — the backstop value decides a legitimate (512K, 1 MiB] body', () => {
  // ~700 KiB: above adapter-node's old 512K default, below the 1 MiB route limit.
  const bandBytes = 700 * 1024;

  it('is answered by the engine end to end under the committed backstop', async () => {
    // A valid initialize padded to ~700 KiB through params._meta (a spec-open
    // field): under the committed backstop the adapter passes it, the route's own
    // 1 MiB bound passes it, and the engine answers with an initialize result.
    const encoded = new TextEncoder().encode(initializeMessage(bandBytes));
    const request = await convertRequestThroughAdapter({
      base: BASE,
      path: '/mcp',
      headers: lowerAuthHeaders({ 'content-length': String(encoded.byteLength) }),
      body: [encoded],
      bodySizeLimit: BACKSTOP.bytes,
    });
    const response = await dispatchThroughMount(request);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain('payload_too_large');
  });

  it('would have been rejected by the adapter under the old 512K default', async () => {
    // Direct read at the adapter layer: the same body the committed backstop
    // passes is rejected by the inherited 512K default before it reaches the
    // route. This is the inversion the committed value fixes, proven where the
    // adapter's rejection is observable cleanly (through the mount it degrades to
    // a generic error, since the engine reads the body outside its 413 catch).
    const request = await convertRequestThroughAdapter({
      base: BASE,
      path: '/mcp',
      headers: lowerAuthHeaders({ 'content-length': String(bandBytes) }),
      body: bytes(bandBytes),
      bodySizeLimit: OLD_DEFAULT_BYTES,
    });
    const rejection = await readExpectingAdapterRejection(request);
    expect(rejection.status).toBe(413);
    expect(rejection.message).toContain('exceeds limit');
  });
});

describe('TRI-48 AC3 — a body above the backstop is rejected by the adapter', () => {
  it('rejects a chunked body above the backstop with a 413 naming BODY_SIZE_LIMIT', async () => {
    const request = await convertRequestThroughAdapter({
      base: BASE,
      path: '/mcp',
      headers: lowerAuthHeaders({ 'transfer-encoding': 'chunked' }),
      body: bytes(BACKSTOP.bytes + 65_536),
      bodySizeLimit: BACKSTOP.bytes,
    });
    const rejection = await readExpectingAdapterRejection(request);
    expect(rejection.status).toBe(413);
    expect(rejection.message).toContain('BODY_SIZE_LIMIT');
  });

  it('admits a chunked body exactly at the backstop (the adapter rejects only above it)', async () => {
    const request = await convertRequestThroughAdapter({
      base: BASE,
      path: '/mcp',
      headers: lowerAuthHeaders({ 'transfer-encoding': 'chunked' }),
      body: bytes(BACKSTOP.bytes),
      bodySizeLimit: BACKSTOP.bytes,
    });
    const received = await request.arrayBuffer();
    expect(received.byteLength).toBe(BACKSTOP.bytes);
  });
});

describe('TRI-48 AC4 — both per-route bounds hold, before dispatch and before any write (AC7)', () => {
  it('rejects a body whose declared content-length exceeds the route limit before reading it', async () => {
    // A tiny actual body with an over-limit declared content-length: only the
    // synchronous declared-length pre-flight can reject this (the streamed count
    // never approaches the limit), so a 413 proves the pre-flight fired.
    //
    // Criterion 7 ("before handler dispatch and before any database write") is a
    // code invariant here rather than a separately observed one: boundRequestBody
    // throws before it calls `request.body.getReader()` and before the handler is
    // dispatched, so no /mcp write path is even reachable to observe on this path.
    // (A pull-counter on the body was tried and is unreliable — undici eagerly
    // buffers a fabricated stream request independent of the engine.)
    const request = new Request(`${BASE}/mcp`, {
      method: 'POST',
      headers: lowerAuthHeaders({ 'content-length': String(ROUTE_LIMIT + 1) }),
      body: 'tiny',
    });
    const response = await dispatchThroughMount(request);
    const text = await response.text();
    expect(response.status).toBe(413);
    expect(text).toContain('payload_too_large');
  });

  it('catches a body that lies about its content-length via the streamed count', async () => {
    // A small, well-formed declared length must not let an oversized body through:
    // the adapter's streamed byte count is an independent bound and rejects when
    // the actual bytes exceed what was declared.
    const request = await convertRequestThroughAdapter({
      base: BASE,
      path: '/mcp',
      headers: lowerAuthHeaders({ 'content-length': '100' }),
      body: bytes(ROUTE_LIMIT + 262_144),
      bodySizeLimit: BACKSTOP.bytes,
    });
    const rejection = await readExpectingAdapterRejection(request);
    expect(rejection.status).toBe(413);
    expect(rejection.message).toContain('content-length');
  });
});

describe('TRI-48 AC5 — a malformed content-length is rejected, not coerced', () => {
  // Number() would accept every one of these; the engine's strict ^\d+$ grammar
  // rejects them. Sent through the fixture with a fabricated header.
  it.each(['1e3', '0x10', '+100'])('rejects content-length %s', async (declared) => {
    const request = new Request(`${BASE}/mcp`, {
      method: 'POST',
      headers: lowerAuthHeaders({ 'content-length': declared }),
      body: initializeMessage(),
    });
    const response = await dispatchThroughMount(request);
    const text = await response.text();
    expect(response.status).toBe(413);
    expect(text).toContain('payload_too_large');
  });

  it('cannot be bypassed with surrounding whitespace — the header layer normalizes it', () => {
    // " 100 " never reaches the grammar as malformed: Headers trims OWS to "100"
    // before the engine parses it. Recorded so the case is not re-raised as a gap.
    const request = new Request(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'content-length': ' 100 ' },
    });
    expect(request.headers.get('content-length')).toBe('100');
  });
});

describe('TRI-48 AC8 — no bounding logic is reimplemented in Tribunal source', () => {
  it("finds no copy of the engine's byte-counting bound under applications/web/src", () => {
    const sourceRoot = resolve(repositoryRoot, 'applications/web/src');
    const entries = readdirSync(sourceRoot, { recursive: true }) as string[];
    const codeFiles = entries.filter(
      (name) => /\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name),
    );
    // Guard against a vacuous pass: the scan must actually have files to read.
    expect(codeFiles.length).toBeGreaterThan(0);
    // Signatures unique to the engine's private bounding implementation; none
    // should appear in Tribunal's own source, which only passes configuration.
    const bannedSignatures = [/receivedBytes/, /McpPayloadTooLargeError/, /duplex:\s*['"]half['"]/];
    const offenders: string[] = [];
    for (const relativePath of codeFiles) {
      const contents = readFileSync(resolve(sourceRoot, relativePath), 'utf8');
      if (bannedSignatures.some((pattern) => pattern.test(contents))) offenders.push(relativePath);
    }
    expect(offenders).toEqual([]);
  });
});
