import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createMcpServer,
  createToolTextResponse,
  defineScopes,
  type McpRegistry,
} from '@lostgradient/mcp';
import type { OAuthHostSeams } from '@lostgradient/mcp/oauth';
import type { OAuthStores } from '@lostgradient/mcp/oauth/stores';
import { createSvelteKitMcpMount, type SvelteKitMcpMount } from '@lostgradient/mcp/sveltekit';

const tribunalVocabulary = defineScopes({
  'reviews:read': 'Read Tribunal review results.',
});

const tribunalRegistry: McpRegistry<'reviews:read'> = tribunalVocabulary.defineRegistry({
  tools: [],
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
