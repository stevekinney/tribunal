import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createMcpServer } from './server.js';
import { mcpScopes } from './scopes.js';
import type { McpUserProfile } from './types/primitives.js';

function conformanceUser(userId: string): McpUserProfile {
  return {
    id: userId,
    email: 'conformance@localhost',
    name: 'Conformance User',
    image: null,
    role: 'user',
  };
}

const handler = createMcpHandler(
  () => {
    const userId = randomUUID();
    return createMcpServer({
      userId,
      user: conformanceUser(userId),
      enableUiExtension: false,
      enableConformanceMode: true,
      scopes: mcpScopes,
    });
  },
  { legacy: 'stateless' },
);

async function fetchThroughHandler(input: string | URL, init?: RequestInit): Promise<Response> {
  return handler.fetch(new Request(input, init));
}

describe('MCP 2026-07-28 (modern) conformance', () => {
  it('negotiates the modern era via server/discover with no session state', async () => {
    const client = new Client(
      { name: 'modern-conformance-client', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    const transport = new StreamableHTTPClientTransport(new URL('http://conformance.local/mcp'), {
      fetch: fetchThroughHandler,
    });

    await client.connect(transport);
    expect(client.getProtocolEra()).toBe('modern');

    await client.close();
  });

  it('lists capabilities and invokes a tool without an initialization handshake', async () => {
    const client = new Client(
      { name: 'modern-conformance-client', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    const transport = new StreamableHTTPClientTransport(new URL('http://conformance.local/mcp'), {
      fetch: fetchThroughHandler,
    });

    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === 'test_simple_text')).toBe(true);

    const result = await client.callTool({ name: 'test_simple_text', arguments: {} });
    expect(Boolean(result.isError)).toBe(false);

    await client.close();
  });

  it('reads a resource and gets a prompt on the modern era (every advertised primitive kind, not just tools)', async () => {
    const client = new Client(
      { name: 'modern-conformance-client-primitives', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    const transport = new StreamableHTTPClientTransport(new URL('http://conformance.local/mcp'), {
      fetch: fetchThroughHandler,
    });
    await client.connect(transport);

    const resources = await client.listResources();
    expect(
      resources.resources.some((resource) => resource.name === 'test_static_text_resource'),
    ).toBe(true);

    const resourceResult = await client.readResource({ uri: 'test://static-text' });
    expect(resourceResult.contents.length).toBeGreaterThan(0);

    const prompts = await client.listPrompts();
    expect(prompts.prompts.some((prompt) => prompt.name === 'test_simple_prompt')).toBe(true);

    const promptResult = await client.getPrompt({ name: 'test_simple_prompt' });
    expect(promptResult.messages.length).toBeGreaterThan(0);

    await client.close();
  });

  it('rejects a JSON-RPC batch on the modern path', async () => {
    const response = await fetchThroughHandler('http://conformance.local/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
      },
      body: JSON.stringify([
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
        },
      ]),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  // No `mcp-protocol-version` header and no per-request `_meta` envelope
  // claim classifies as LEGACY traffic (served through the stateless
  // fallback) per the SDK's own `isLegacyRequest` documentation, not the
  // modern path — the genuine modern-lane case follows immediately after.
  it('answers a bare legacy notification POST (no envelope claim) with 202 via the stateless legacy fallback', async () => {
    const response = await fetchThroughHandler('http://conformance.local/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('answers a modern notification POST (protocol-version header + _meta envelope claim) with 202 and an empty body', async () => {
    const response = await fetchThroughHandler('http://conformance.local/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: {
          requestId: 1,
          _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
        },
      }),
    });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('carries the required resultType/ttlMs/cacheScope wire fields on a cacheable modern result', async () => {
    const response = await fetchThroughHandler('http://conformance.local/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result?: { resultType?: string; ttlMs?: number; cacheScope?: string };
    };
    // `tools/list` is one of the six cacheable methods (SEP-2549) — the
    // 2026-07-28 wire codec fills these on every such result, even when
    // no explicit cache hint is configured (the conservative defaults).
    expect(body.result?.resultType).toBe('complete');
    expect(typeof body.result?.ttlMs).toBe('number');
    expect(['public', 'private']).toContain(body.result?.cacheScope);
  });

  it('rejects a request whose MCP-Protocol-Version header disagrees with its envelope', async () => {
    const response = await fetchThroughHandler('http://conformance.local/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
      }),
    });

    expect(response.status).toBe(400);
  });
});
