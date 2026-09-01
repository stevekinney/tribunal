import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createMcpServer,
  createToolTextResponse,
  defineScopes,
  setLogger,
  type McpRegistry,
} from '@lostgradient/mcp';
import { engineLogger } from '@lostgradient/mcp/logger';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { DestinationStream } from 'pino';
import { z } from 'zod';
import type { OAuthHostSeams } from '@lostgradient/mcp/oauth';
import type { OAuthStores } from '@lostgradient/mcp/oauth/stores';
import { createSvelteKitMcpMount, type SvelteKitMcpMount } from '@lostgradient/mcp/sveltekit';
import { createMcpLogger, mcpLogger } from './mcp-logger';

class MemoryDestination implements DestinationStream {
  output = '';

  write(message: string): void {
    this.output += message;
  }
}

const tribunalVocabulary = defineScopes({
  'reviews:read': 'Read Tribunal review results.',
});

const tribunalRegistry: McpRegistry<'reviews:read'> = tribunalVocabulary.defineRegistry({
  tools: [
    tribunalVocabulary.defineTool({
      name: 'failing_review_lookup',
      title: 'Failing review lookup',
      description: 'Returns a deliberate failure for logger integration testing.',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      requiredScope: 'reviews:read',
      handler: async () => ({
        content: [{ type: 'text', text: 'Bearer tool-result-secret' }],
        isError: true,
      }),
    }),
  ],
  resources: [
    tribunalVocabulary.defineResource({
      name: 'review-result',
      title: 'Review result',
      uri: 'tribunal://reviews/latest',
      description: 'The latest Tribunal review result.',
      mimeType: 'application/json',
      requiredScope: 'reviews:read',
      handler: async () => ({
        contents: [
          {
            uri: 'tribunal://reviews/latest',
            mimeType: 'application/json',
            text: '{"status":"complete"}',
          },
        ],
      }),
    }),
  ],
  prompts: [],
});

beforeAll(() => {
  vi.stubEnv('MCP_SERVER_NAME', 'tribunal-mcp-server');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('@lostgradient/mcp published package adoption', () => {
  it('constructs a server with Tribunal-owned registry and scope vocabulary', () => {
    const server = createMcpServer(
      {
        userId: 'tribunal-user',
        user: {
          id: 'tribunal-user',
          email: 'user@tribunal.local',
          name: 'Tribunal User',
          image: null,
          role: 'user',
        },
        enableUiExtension: false,
        enableConformanceMode: false,
        scopes: ['reviews:read'],
      },
      tribunalRegistry,
    );

    expect(server).toBeDefined();
    expect(tribunalVocabulary.scopes).toEqual(['reviews:read']);
    expect(tribunalRegistry.resources[0]?.requiredScope).toBe('reviews:read');
  });

  it('measures the tool result cap in UTF-8 bytes', () => {
    const multiByteResult = '中'.repeat(200_000);

    expect(multiByteResult.length).toBeLessThan(256 * 1024);
    expect(new TextEncoder().encode(multiByteResult).length).toBeGreaterThan(256 * 1024);
    expect(createToolTextResponse(multiByteResult)).toMatchObject({ isError: true });
  });

  it('routes installed-engine records through Tribunal redaction', async () => {
    const destination = new MemoryDestination();
    const tribunalLogger = createMcpLogger({ destination });
    const credential = 'Bearer engine-log-secret';
    setLogger(tribunalLogger);

    const server = createMcpServer(
      {
        userId: 'tribunal-user',
        user: {
          id: 'tribunal-user',
          email: 'user@tribunal.local',
          name: 'Tribunal User',
          image: null,
          role: 'user',
        },
        enableUiExtension: false,
        enableConformanceMode: false,
        scopes: ['reviews:read'],
      },
      tribunalRegistry,
    );
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'tribunal-logger-test', version: '1.0.0' });

    try {
      engineLogger.warn({ authorization: credential }, 'engine redaction canary');
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const result = await client.callTool({ name: 'failing_review_lookup', arguments: {} });

      expect(result.isError).toBe(true);
      expect(destination.output).toContain('mcp_tool_call');
      expect(destination.output).toContain('tool_failure');
      expect(destination.output).not.toContain(credential);
    } finally {
      await client.close();
      await server.close();
      setLogger(mcpLogger);
    }
  });

  it('publishes the OAuth seams, stores, and SvelteKit mount subpaths', () => {
    const oauthSurfaceTypeCheck = <Scope extends string>(
      seams: OAuthHostSeams<Scope>,
      stores: OAuthStores,
      mount: SvelteKitMcpMount,
    ) => ({ seams, stores, mount });

    expect(typeof createSvelteKitMcpMount).toBe('function');
    expect(typeof oauthSurfaceTypeCheck).toBe('function');
  });
});
