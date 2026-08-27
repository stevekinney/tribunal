import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createMcpServer } from './server.js';
import { allTools, conformanceOnlyTools } from './tools/index.js';
import { allResources } from './resources/index.js';
import { allPrompts } from './prompts/index.js';
import { createToolTextResponse } from './tool-response.js';
import { mcpScopes } from './scopes.js';
import type {
  McpPromptDefinition,
  McpResourceDefinition,
  McpToolDefinition,
  McpUserProfile,
} from './types/primitives.js';

/**
 * Wire-level proof that a token's granted scopes actually gate
 * `tools/call`, `resources/read`, and `prompts/get` -- not just that
 * `requiredScope` is declared in the registry. Drives a real in-process
 * `Client` against a real `McpServer`.
 *
 * This package ships zero default tools, resources, or prompts (it is
 * the reusable engine, not a fixed capability set), so a fixture of each
 * kind is pushed into the real production registries for the duration of
 * this suite -- exercising the actual scope-enforcement code path in
 * `server.ts` end to end, not a mock of it.
 */

const fixtureTool: McpToolDefinition = {
  name: 'scope_fixture_tool',
  title: 'Scope fixture tool',
  description: 'A fixture tool for scope-enforcement tests.',
  inputSchema: z.object({}),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  requiredScope: 'profile:read',
  handler: async () => createToolTextResponse('fixture tool result'),
};

const fixtureConformanceOnlyTool: McpToolDefinition = {
  ...fixtureTool,
  name: 'scope_fixture_conformance_tool',
  requiredScope: 'audit:read',
};

const fixtureResource: McpResourceDefinition = {
  name: 'scope_fixture_resource',
  title: 'Scope fixture resource',
  uri: 'test://scope-fixture-resource',
  description: 'A fixture resource for scope-enforcement tests.',
  mimeType: 'text/plain',
  requiredScope: 'profile:read',
  handler: async (uri) => ({
    contents: [{ uri: uri.toString(), mimeType: 'text/plain', text: 'fixture resource content' }],
  }),
};

const fixturePrompt: McpPromptDefinition<{ topic: z.ZodString }> = {
  name: 'scope_fixture_prompt',
  title: 'Scope fixture prompt',
  description: 'A fixture prompt for scope-enforcement tests.',
  arguments: { topic: z.string().describe('Topic to build a fixture message about.') },
  requiredScope: 'prompts:read',
  handler: async (arguments_) => ({
    messages: [
      { role: 'user', content: { type: 'text', text: `Fixture prompt about ${arguments_.topic}` } },
    ],
  }),
};

beforeEach(() => {
  allTools.push(fixtureTool);
  conformanceOnlyTools.push(fixtureConformanceOnlyTool);
  allResources.push(fixtureResource);
  allPrompts.push(fixturePrompt);
});

afterEach(() => {
  allTools.length = 0;
  conformanceOnlyTools.length = 0;
  allResources.length = 0;
  allPrompts.length = 0;
});

function scopeTestUser(userId: string): McpUserProfile {
  return {
    id: userId,
    email: 'scope-enforcement@localhost',
    name: 'Scope Enforcement User',
    image: null,
    role: 'user',
  };
}

async function connectedClientWithScopes(
  scopes: readonly string[],
  enableConformanceMode = false,
): Promise<Client> {
  const handler = createMcpHandler(
    () => {
      const userId = randomUUID();
      return createMcpServer({
        userId,
        user: scopeTestUser(userId),
        enableUiExtension: false,
        enableConformanceMode,
        scopes,
      });
    },
    { legacy: 'stateless' },
  );
  const client = new Client({ name: 'scope-enforcement-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL('http://scope-enforcement.local/mcp'),
    {
      fetch: (input, init) => handler.fetch(new Request(input, init)),
    },
  );
  await client.connect(transport);
  return client;
}

describe('tool scope enforcement', () => {
  it('lists the fixture tool regardless of granted scopes', async () => {
    const client = await connectedClientWithScopes([]);
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === 'scope_fixture_tool')).toBe(true);
    await client.close();
  });

  it('answers a call with a granted scope normally', async () => {
    const client = await connectedClientWithScopes(['profile:read']);
    const result = await client.callTool({ name: 'scope_fixture_tool', arguments: {} });
    expect(result.isError).not.toBe(true);
    await client.close();
  });

  it('refuses a call missing the required scope with an isError result carrying the challenge', async () => {
    const client = await connectedClientWithScopes([]);
    const result = await client.callTool({ name: 'scope_fixture_tool', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result._meta as Record<string, unknown> | undefined)?.['mcp/www_authenticate']).toBe(
      'Bearer error="insufficient_scope", scope="profile:read"',
    );
    await client.close();
  });

  it('refuses a call when only an unrelated scope is granted', async () => {
    const client = await connectedClientWithScopes(['prompts:read']);
    const result = await client.callTool({ name: 'scope_fixture_tool', arguments: {} });
    expect(result.isError).toBe(true);
    await client.close();
  });
});

describe('resource scope enforcement', () => {
  it('reads the fixture resource with a granted scope', async () => {
    const client = await connectedClientWithScopes(['profile:read']);
    const result = await client.readResource({ uri: 'test://scope-fixture-resource' });
    expect(result.contents.length).toBeGreaterThan(0);
    await client.close();
  });

  it('rejects reading the fixture resource without profile:read, carrying the challenge in the error data', async () => {
    const client = await connectedClientWithScopes([]);
    await expect(
      client.readResource({ uri: 'test://scope-fixture-resource' }),
    ).rejects.toMatchObject({
      code: -32003,
      data: expect.objectContaining({
        requiredScope: 'profile:read',
        _meta: {
          'mcp/www_authenticate': 'Bearer error="insufficient_scope", scope="profile:read"',
        },
      }),
    });
    await client.close();
  });
});

describe('prompt scope enforcement', () => {
  it('gets the fixture prompt with a granted scope', async () => {
    const client = await connectedClientWithScopes(['prompts:read']);
    const result = await client.getPrompt({
      name: 'scope_fixture_prompt',
      arguments: { topic: 'oauth' },
    });
    expect(result.messages.length).toBeGreaterThan(0);
    await client.close();
  });

  it('rejects getting the fixture prompt without prompts:read, carrying the challenge in the error data', async () => {
    const client = await connectedClientWithScopes([]);
    await expect(
      client.getPrompt({ name: 'scope_fixture_prompt', arguments: { topic: 'oauth' } }),
    ).rejects.toMatchObject({
      code: -32003,
      data: expect.objectContaining({
        requiredScope: 'prompts:read',
        _meta: {
          'mcp/www_authenticate': 'Bearer error="insufficient_scope", scope="prompts:read"',
        },
      }),
    });
    await client.close();
  });
});

describe('conformance-only scope', () => {
  it('gates the conformance-only fixture tool only when conformance mode is on', async () => {
    const client = await connectedClientWithScopes(mcpScopes, true);
    const result = await client.callTool({ name: 'scope_fixture_conformance_tool', arguments: {} });
    expect(result.isError).not.toBe(true);
    await client.close();
  });

  it('is refused, with the challenge, when conformance mode is on but audit:read was not granted', async () => {
    const client = await connectedClientWithScopes(['profile:read', 'prompts:read'], true);
    const result = await client.callTool({ name: 'scope_fixture_conformance_tool', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result._meta as Record<string, unknown> | undefined)?.['mcp/www_authenticate']).toBe(
      'Bearer error="insufficient_scope", scope="audit:read"',
    );
    await client.close();
  });

  it('is absent entirely from tools/list when conformance mode is off', async () => {
    const client = await connectedClientWithScopes(mcpScopes, false);
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === 'scope_fixture_conformance_tool')).toBe(false);
    await client.close();
  });
});
