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
      // Conformance mode on: this package ships zero default tools, so
      // the always-present `test_simple_text` conformance fixture is what
      // proves a real tools/call round-trip over this transport.
      enableConformanceMode: true,
      scopes: mcpScopes,
    });
  },
  { legacy: 'stateless' },
);

async function fetchThroughHandler(input: string | URL, init?: RequestInit): Promise<Response> {
  return handler.fetch(new Request(input, init));
}

describe('MCP 2025-11-25 (legacy) conformance', () => {
  it('connects a Claude-compatible client through the SDK legacy handshake', async () => {
    const client = new Client({ name: 'legacy-conformance-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('http://conformance.local/mcp'), {
      fetch: fetchThroughHandler,
    });

    await client.connect(transport);
    expect(client.getProtocolEra()).toBe('legacy');

    await client.close();
  });

  it('lists capabilities and invokes a tool over the stateless legacy fallback', async () => {
    const client = new Client({ name: 'legacy-conformance-client', version: '1.0.0' });
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

  it('carries no resultType/ttlMs/cacheScope wire fields on a legacy result (those are modern-only, SEP-2549)', async () => {
    const response = await fetchThroughHandler('http://conformance.local/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(200);
    const rawText = await response.text();
    // The legacy stateless fallback answers over SSE (`event:
    // message\ndata: {...}`) when the client accepts `text/event-stream`
    // too, rather than plain JSON — unwrap the `data:` payload either way.
    const jsonText = rawText.trimStart().startsWith('event:')
      ? (rawText.match(/^data: (.+)$/m)?.[1] ?? '{}')
      : rawText;
    const body = JSON.parse(jsonText) as {
      result?: { resultType?: unknown; ttlMs?: unknown; cacheScope?: unknown };
    };
    expect(body.result?.resultType).toBeUndefined();
    expect(body.result?.ttlMs).toBeUndefined();
    expect(body.result?.cacheScope).toBeUndefined();
  });

  it("answers a bare notification POST with 202 and an empty body (the legacy lane genuinely, unlike the modern-conformance suite's equivalent name)", async () => {
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
});
