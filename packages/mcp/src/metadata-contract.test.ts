import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { allTools, conformanceOnlyTools } from './tools/index.js';
import { allResources } from './resources/index.js';
import { allPrompts } from './prompts/index.js';
import { createMcpServer } from './server.js';
import { createTestContext } from './testing/context.js';
import { getSupportedScopes } from './supported-scopes.js';
import { mcpScopes } from './scopes.js';
import type { McpUserProfile } from './types/primitives.js';

/**
 * META-001: the registry contract that turns a metadata gap into a review
 * failure. This intentionally checks the *production* registries
 * (`allTools`/`allResources`/`allPrompts` and a `createMcpServer` instance
 * built with `enableConformanceMode: false`) — the conformance-only
 * fixtures registered by `registerConformanceFixtures` are test
 * infrastructure, not operations this server advertises to a real
 * connector, and are out of scope here.
 */

const snakeCaseName = /^[a-z][a-z0-9_]*$/;
const maxToolNameLength = 64;

describe('tool registry metadata contract', () => {
  it('every tool has a snake_case name at most 64 characters', () => {
    for (const tool of allTools) {
      expect(tool.name).toMatch(snakeCaseName);
      expect(tool.name.length).toBeLessThanOrEqual(maxToolNameLength);
    }
  });

  it('every tool has a title and a non-empty description', () => {
    for (const tool of allTools) {
      expect(tool.title, `${tool.name} is missing a title`).toBeTruthy();
      expect(tool.description, `${tool.name} is missing a description`).toBeTruthy();
    }
  });

  it('every tool declares an inputSchema', () => {
    for (const tool of allTools) {
      expect(tool.inputSchema, `${tool.name} is missing an inputSchema`).toBeDefined();
    }
  });

  it('every input parameter has its own description', () => {
    for (const tool of allTools) {
      const shape = (tool.inputSchema as { shape?: Record<string, { description?: string }> })
        .shape;
      if (!shape) continue;
      for (const [parameterName, parameterSchema] of Object.entries(shape)) {
        expect(
          parameterSchema.description,
          `${tool.name}'s "${parameterName}" parameter has no .describe()`,
        ).toBeTruthy();
      }
    }
  });

  it('every tool declares all four safety annotations as booleans', () => {
    for (const tool of allTools) {
      expect(tool.annotations, `${tool.name} is missing annotations`).toBeDefined();
      for (const hint of [
        'readOnlyHint',
        'destructiveHint',
        'idempotentHint',
        'openWorldHint',
      ] as const) {
        expect(
          typeof tool.annotations[hint],
          `${tool.name}.annotations.${hint} must be a boolean`,
        ).toBe('boolean');
      }
    }
  });

  /**
   * Write or destructive tools require host-visible approval and
   * accurate annotations. The host (Claude, Codex, ChatGPT) is what
   * actually gates a destructive call behind human approval -- that half
   * is outside this package -- and this server's whole contribution is
   * making sure the annotations a host reads to decide that are never
   * wrong. Two things regress otherwise:
   * a tool that mutates data but is marked `readOnlyHint: true` (a host
   * would never prompt for it), or one marked `destructiveHint: true`
   * while also `readOnlyHint: true` (a self-contradictory pair no host
   * can act on consistently). `allTools` currently has no write or
   * destructive tool at all -- this test is the guard that makes adding
   * one honestly is enforced, not merely documented.
   */
  it('a destructive tool is never also marked read-only, across every registry', () => {
    for (const tool of [...allTools, ...conformanceOnlyTools]) {
      if (tool.annotations.destructiveHint) {
        expect(
          tool.annotations.readOnlyHint,
          `${tool.name} is marked both destructiveHint and readOnlyHint -- a host cannot act on that consistently`,
        ).toBe(false);
      }
    }
  });

  it('every tool declares a requiredScope from the supported vocabulary', () => {
    for (const tool of allTools) {
      expect(tool.requiredScope, `${tool.name} is missing a requiredScope`).toBeTruthy();
      expect(
        mcpScopes as readonly string[],
        `${tool.name}.requiredScope ("${tool.requiredScope}") is not in the supported scope vocabulary`,
      ).toContain(tool.requiredScope);
    }
  });

  it('every tool that declares an outputSchema returns structuredContent that validates against it', async () => {
    const context = createTestContext();
    for (const tool of allTools) {
      if (!tool.outputSchema) continue;

      // Parse `{}` through the tool's own inputSchema (rather than
      // calling the handler with a bare `{}`) so Zod defaults apply the
      // same way they do for a real `tools/call` — bypassing that would
      // exercise a shape no real caller ever produces.
      const input = tool.inputSchema.parse({});
      const result = await tool.handler(input, context);
      expect(
        result.isError,
        `${tool.name} returned an error from its metadata-contract smoke call`,
      ).not.toBe(true);
      expect(
        result.structuredContent,
        `${tool.name} declares an outputSchema but returned no structuredContent`,
      ).toBeDefined();

      const parsed = tool.outputSchema.safeParse(result.structuredContent);
      expect(
        parsed.success,
        `${tool.name}'s structuredContent does not validate against its own outputSchema`,
      ).toBe(true);
    }
  });
});

describe('resource registry metadata contract', () => {
  it('every resource has a name, title, uri, description, and mimeType', () => {
    for (const resource of allResources) {
      expect(resource.name).toBeTruthy();
      expect(resource.title, `${resource.name} is missing a title`).toBeTruthy();
      expect(resource.uri).toBeTruthy();
      expect(resource.description, `${resource.name} is missing a description`).toBeTruthy();
      expect(resource.mimeType).toBeTruthy();
    }
  });

  it('every resource declares a requiredScope from the supported vocabulary', () => {
    for (const resource of allResources) {
      expect(resource.requiredScope, `${resource.name} is missing a requiredScope`).toBeTruthy();
      expect(mcpScopes as readonly string[]).toContain(resource.requiredScope);
    }
  });
});

describe('prompt registry metadata contract', () => {
  it('every prompt has a name, title, and description', () => {
    for (const prompt of allPrompts) {
      expect(prompt.name).toBeTruthy();
      expect(prompt.title, `${prompt.name} is missing a title`).toBeTruthy();
      expect(prompt.description, `${prompt.name} is missing a description`).toBeTruthy();
    }
  });

  it('every prompt declares a requiredScope from the supported vocabulary', () => {
    for (const prompt of allPrompts) {
      expect(prompt.requiredScope, `${prompt.name} is missing a requiredScope`).toBeTruthy();
      expect(mcpScopes as readonly string[]).toContain(prompt.requiredScope);
    }
  });
});

describe('getSupportedScopes', () => {
  it('is the sorted union of every production requiredScope, excluding conformance-only scopes', () => {
    const expected = new Set<string>();
    for (const tool of allTools) expected.add(tool.requiredScope);
    for (const resource of allResources) expected.add(resource.requiredScope);
    for (const prompt of allPrompts) expected.add(prompt.requiredScope);

    expect(getSupportedScopes()).toEqual([...expected].sort());
    // A conformance-only scope must never be advertised to a real OAuth
    // client. `getSupportedScopes()` walks only the production registries, so
    // any scope declared exclusively by a `conformanceOnlyTools` entry is
    // excluded structurally rather than by a second list. `audit:read` was the
    // donor's example; this package ships no such fixture yet, so the
    // assertion guards the mechanism rather than a specific tool.
    expect(getSupportedScopes()).not.toContain('audit:read');
  });
});

function conformanceUser(userId: string): McpUserProfile {
  return {
    id: userId,
    email: 'metadata-contract@localhost',
    name: 'Metadata Contract User',
    image: null,
    role: 'user',
  };
}

describe('wire capabilities and list ordering', () => {
  const handler = createMcpHandler(
    () => {
      const userId = randomUUID();
      return createMcpServer({
        userId,
        user: conformanceUser(userId),
        enableUiExtension: false,
        enableConformanceMode: false,
        scopes: getSupportedScopes(),
      });
    },
    { legacy: 'stateless' },
  );

  async function connectedClient(): Promise<Client> {
    const client = new Client({ name: 'metadata-contract-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL('http://metadata-contract.local/mcp'),
      {
        fetch: (input, init) => handler.fetch(new Request(input, init)),
      },
    );
    await client.connect(transport);
    return client;
  }

  it('advertises no capability this server does not genuinely implement', async () => {
    const client = await connectedClient();
    const capabilities = client.getServerCapabilities();

    // Never real server capabilities in the first place (they describe
    // what a *client* offers), and nothing here ever calls them.
    expect((capabilities as Record<string, unknown> | undefined)?.sampling).toBeUndefined();
    expect((capabilities as Record<string, unknown> | undefined)?.elicitation).toBeUndefined();

    // No `logging/setLevel` handler and no production caller of
    // `notifications/message` outside the conformance-only fixtures.
    expect(capabilities?.logging).toBeUndefined();

    // Nothing in this codebase ever sends a `list_changed` notification.
    expect(capabilities?.tools?.listChanged).toBe(false);
    expect(capabilities?.resources?.listChanged).toBe(false);
    expect(capabilities?.prompts?.listChanged).toBe(false);

    // `resources.subscribe` IS genuinely implemented on the modern
    // (`2026-07-28`) era, but only when a `publishResourceUpdate`
    // function is wired in -- a consuming application does that with its
    // own per-user event bus, which is what makes delivery
    // authorization-safe. `connectedClient()` above uses a default
    // `Client` with no `versionNegotiation`, which negotiates the LEGACY
    // era — legacy serving is stateless-per-request with no session to
    // push a subscription stream to, so it stays unadvertised there
    // regardless. `scope-enforcement.test.ts` and `server.test.ts`
    // exercise scope enforcement and capability advertisement against
    // this package's own registries directly.
    expect(capabilities?.resources?.subscribe).toBeUndefined();

    await client.close();
  });

  it('returns tools/list in a deterministic order across repeated calls', async () => {
    const client = await connectedClient();

    const first = await client.listTools();
    const second = await client.listTools();

    expect(first.tools.map((tool) => tool.name)).toEqual(second.tools.map((tool) => tool.name));
    expect(first.tools.map((tool) => tool.name)).toEqual(allTools.map((tool) => tool.name));

    await client.close();
  });

  it('never advertises a conformance-only fixture in a production discovery response', async () => {
    const client = await connectedClient();

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).not.toContain('list_audit_events');

    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.name)).not.toContain(
      'test_static_text_resource',
    );

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).not.toContain('test_simple_prompt');

    await client.close();
  });
});

describe('MCP Apps capability advertisement', () => {
  it('stays absent even when enableUiExtension is true, because no application resource is registered', async () => {
    const handler = createMcpHandler(
      () => {
        const userId = randomUUID();
        return createMcpServer({
          userId,
          user: conformanceUser(userId),
          // The flag alone is not enough — this package ships no default
          // resources, so `allResources` has no `RESOURCE_MIME_TYPE`
          // entry, and the capability must not appear on the wire
          // regardless of this flag.
          enableUiExtension: true,
          enableConformanceMode: false,
          scopes: getSupportedScopes(),
        });
      },
      { legacy: 'stateless' },
    );
    const client = new Client({ name: 'ui-extension-contract-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('http://ui-extension.local/mcp'), {
      fetch: (input, init) => handler.fetch(new Request(input, init)),
    });
    await client.connect(transport);

    const capabilities = client.getServerCapabilities() as
      Record<string, Record<string, unknown> | undefined> | undefined;
    expect(capabilities?.experimental).toEqual({});

    await client.close();
  });
});
