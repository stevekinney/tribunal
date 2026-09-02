import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createConsumerConformanceHandler, type McpContext } from '@lostgradient/mcp';
import { describe, expect, it, vi } from 'vitest';
import { conformanceFixtureTool } from './conformance-fixture';
import { tribunalMcpRegistry } from './registry';
import { tribunalScopeVocabulary } from './scope-vocabulary';
import { readToolResultText } from './tool-result-text';

vi.mock('$env/dynamic/private', () => ({ env: { MCP_SERVER_NAME: 'tribunal-mcp-server' } }));

function context(): McpContext {
  return {
    userId: 'not-a-tribunal-user',
    user: { id: 'x', email: 'x@example.com', name: 'X', image: null, role: 'user' },
    signal: new AbortController().signal,
  };
}

describe('conformance fixture', () => {
  it('requires the reserved conformance scope and nothing else', () => {
    expect.assertions(2);

    expect(conformanceFixtureTool.requiredScope).toBe('conformance:read');
    expect(conformanceFixtureTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('returns a fixed synthetic payload that names itself as such', async () => {
    expect.assertions(2);

    const result = await conformanceFixtureTool.handler({ label: 'probe-42' }, context());

    expect(result.structuredContent).toEqual({
      label: 'probe-42',
      synthetic: true,
      surface: 'tools/call',
    });
    expect(readToolResultText(result)).toMatch(/synthetic and describes no real data/);
  });

  it('does not resolve a Tribunal user, because it reads nothing owned by one', async () => {
    expect.assertions(1);

    // Every production tool refuses this subject. The fixture accepts it: it
    // touches no reader, so there is no ownership to check, and a harness
    // should be able to drive it without a real account.
    const result = await conformanceFixtureTool.handler({ label: 'conformance' }, context());

    expect(result.isError).toBeUndefined();
  });
});

/**
 * The fixture exists to be exercised through the protocol, so the property
 * that matters is not that its handler works in isolation — the tests above
 * cover that — but that with conformance mode on, a real MCP client can list
 * it and call it and get a schema-valid result.
 *
 * `runMcpConformance` builds its handler with conformance mode off, so it
 * never touches the fixture; this drives `createConsumerConformanceHandler`
 * with the mode on, mirroring the harness's own client and transport wiring.
 * Without this, a regression in `createMcpServer` that stopped registering
 * `conformanceOnlyTools`, or registered them without their `outputSchema`,
 * would leave every other test green while making the fixture unreachable.
 */
describe('conformance fixture over the protocol', () => {
  async function connectWithConformanceMode() {
    const handler = createConsumerConformanceHandler({
      registry: tribunalMcpRegistry,
      scopeVocabulary: tribunalScopeVocabulary,
      enableConformanceMode: true,
      identity: {
        userId: '7',
        user: { id: '7', email: 'c@example.com', name: 'C', image: null, role: 'user' },
      },
    });
    const client = new Client(
      { name: 'fixture-conformance-test', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      // No explicit Host header: the loopback URL already supplies a loopback
      // Host, so the handler's rebinding check passes without one. The upstream
      // harness sets it belt-and-suspenders; here it is redundant, and setting
      // it through `Request.headers` is a mutation some fetch runtimes forbid.
      fetch: (input, init) => handler.fetch(new Request(input, init)),
    });
    await client.connect(transport);
    return client;
  }

  it('lists the fixture when conformance mode is on', async () => {
    expect.assertions(1);
    const client = await connectWithConformanceMode();

    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toContain('conformance_echo');
    } finally {
      await client.close();
    }
  });

  it('calls the fixture through the protocol and gets a schema-valid result', async () => {
    expect.assertions(2);
    const client = await connectWithConformanceMode();

    try {
      // Arguments omitted on purpose: the protocol layer has to apply the
      // input default, which a direct handler call would bypass.
      const result = await client.callTool({ name: 'conformance_echo', arguments: {} });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        label: 'conformance',
        synthetic: true,
        surface: 'tools/call',
      });
    } finally {
      await client.close();
    }
  });
});
