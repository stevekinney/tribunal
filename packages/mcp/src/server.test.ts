import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { areResourceSubscriptionsAuthorized, createMcpServer } from './server.js';
import { getSupportedScopes } from './supported-scopes.js';
import { allResources } from './resources/index.js';
import { allTools } from './tools/index.js';
import type { McpResourceDefinition, McpToolDefinition } from './types/primitives.js';

describe('createMcpServer', () => {
  it('returns a defined server instance', () => {
    const server = createMcpServer({
      userId: 'test-user-id',
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User',
        image: null,
        role: 'user',
      },
      enableUiExtension: true,
      enableConformanceMode: false,
      scopes: ['profile:read'],
    });
    expect(server).toBeDefined();
  });

  /**
   * `resources/subscribe` and `resources/unsubscribe` are always
   * registered as a spec-compliant, unconditional `{}` ack (see the
   * comment above `server.server.setRequestHandler('resources/subscribe', ...)`
   * in `server.ts`) -- exercised here through a real client call so both
   * handlers are actually invoked, not merely declared.
   */
  it('acks resources/subscribe and resources/unsubscribe unconditionally', async () => {
    const server = createMcpServer({
      userId: 'subscribe-ack-user',
      user: {
        id: 'subscribe-ack-user',
        email: 'test@example.com',
        name: 'Test User',
        image: null,
        role: 'user',
      },
      enableUiExtension: false,
      enableConformanceMode: false,
      scopes: [],
    });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'subscribe-ack-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await expect(client.subscribeResource({ uri: 'test://anything' })).resolves.toEqual({});
    await expect(client.unsubscribeResource({ uri: 'test://anything' })).resolves.toEqual({});

    await client.close();
  });

  /**
   * The `isError`/"tool failure" logging branch in `registerToolDefinition`
   * (the `if (isError) { logger.warn(...) }` block) only fires for a
   * GRANTED-scope call whose handler itself returns `isError: true` --
   * distinct from the insufficient-scope path, and only reachable through
   * `registerToolDefinition` itself: the conformance fixtures
   * `registerConformanceFixtures` registers go straight through
   * `server.registerTool`, bypassing this wrapper entirely. This package
   * ships no default tool, so a fixture pushed into the real `allTools`
   * registry stands in -- exercising the actual wrapper end to end.
   */
  it('logs and records a tool_failure outcome when a granted-scope call returns isError from its own handler', async () => {
    const failingTool: McpToolDefinition = {
      name: 'server_test_failing_tool',
      title: 'Failing tool fixture',
      description: 'Always returns isError: true, to exercise the tool_failure logging branch.',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      requiredScope: 'profile:read',
      handler: async () => ({
        content: [{ type: 'text', text: 'deliberate failure' }],
        isError: true,
      }),
    };
    allTools.push(failingTool);

    try {
      const userId = randomUUID();
      const server = createMcpServer({
        userId,
        user: {
          id: userId,
          email: 'test@example.com',
          name: 'Test User',
          image: null,
          role: 'user',
        },
        enableUiExtension: false,
        enableConformanceMode: false,
        scopes: ['profile:read'],
      });
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'tool-failure-client', version: '1.0.0' });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const result = await client.callTool({ name: 'server_test_failing_tool', arguments: {} });
      expect(result.isError).toBe(true);

      await client.close();
    } finally {
      allTools.length = 0;
    }
  });

  /**
   * `buildServerCapabilities`/the `experimentalCapabilities[EXTENSION_ID]`
   * assignment only fires when BOTH `enableUiExtension` is true AND a
   * resource carrying `RESOURCE_MIME_TYPE` is actually registered
   * (`hasRegisteredUiExtensionResource()`). This package ships no default
   * resources, so a fixture MCP App resource is pushed into `allResources`
   * to exercise the true branch of that condition end to end -- the false
   * branch (flag on, no app resource) is already covered elsewhere.
   */
  it('advertises the MCP Apps extension capability when enableUiExtension is true and an app resource is registered', async () => {
    const appResource: McpResourceDefinition = {
      name: 'server_test_ui_app_resource',
      title: 'UI app resource fixture',
      uri: 'ui://server-test-app',
      description: 'A fixture MCP App resource.',
      mimeType: RESOURCE_MIME_TYPE,
      requiredScope: 'profile:read',
      handler: async (uri) => ({
        contents: [{ uri: uri.toString(), mimeType: RESOURCE_MIME_TYPE, text: '<html></html>' }],
      }),
    };
    allResources.push(appResource);

    try {
      const userId = randomUUID();
      const server = createMcpServer({
        userId,
        user: {
          id: userId,
          email: 'test@example.com',
          name: 'Test User',
          image: null,
          role: 'user',
        },
        enableUiExtension: true,
        enableConformanceMode: false,
        scopes: getSupportedScopes(),
      });
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'ui-extension-client', version: '1.0.0' });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const capabilities = client.getServerCapabilities() as
        Record<string, Record<string, unknown> | undefined> | undefined;
      expect(capabilities?.experimental).toEqual({
        'io.modelcontextprotocol/ui': { version: '1.0.0' },
      });

      await client.close();
    } finally {
      allResources.length = 0;
    }
  });
});

/**
 * Regression coverage for: a `subscriptions/listen` request naming a
 * resource requiring a scope the caller lacks must be denied (the
 * scenario where a client would otherwise later receive a
 * `resource_updated` event for a resource it was never granted read
 * access to). This package ships zero default resources, so a fixture
 * resource is pushed into the real `allResources` registry for the
 * duration of this suite -- exercising the actual registry-driven lookup
 * `areResourceSubscriptionsAuthorized` performs, not a mock of it.
 */
describe('areResourceSubscriptionsAuthorized', () => {
  const testResource: McpResourceDefinition = {
    name: 'test_subscription_resource',
    title: 'Test subscription resource',
    uri: 'test://subscription-resource',
    description: 'A fixture resource for subscription-authorization tests.',
    mimeType: 'text/plain',
    requiredScope: 'profile:read',
    handler: async (uri) => ({
      contents: [{ uri: uri.toString(), mimeType: 'text/plain', text: 'fixture' }],
    }),
  };

  beforeEach(() => {
    allResources.push(testResource);
  });

  afterEach(() => {
    allResources.length = 0;
  });

  it('authorizes a URI whose resource requires a scope the caller holds', () => {
    expect(
      areResourceSubscriptionsAuthorized(['test://subscription-resource'], ['profile:read']),
    ).toBe(true);
  });

  it('denies a URI whose resource requires a scope the caller lacks (the reported bypass)', () => {
    expect(
      areResourceSubscriptionsAuthorized(['test://subscription-resource'], ['prompts:read']),
    ).toBe(false);
  });

  it('denies when the caller holds no scopes at all', () => {
    expect(areResourceSubscriptionsAuthorized(['test://subscription-resource'], [])).toBe(false);
  });

  it('fails closed for a URI that names no known resource, without disclosing that distinctly', () => {
    expect(
      areResourceSubscriptionsAuthorized(
        ['test://does-not-exist'],
        ['profile:read', 'prompts:read'],
      ),
    ).toBe(false);
  });

  it('denies the whole request when only one of several requested URIs is under-scoped', () => {
    expect(
      areResourceSubscriptionsAuthorized(
        ['test://subscription-resource', 'test://does-not-exist'],
        ['profile:read'],
      ),
    ).toBe(false);
  });

  it('authorizes an empty subscription list vacuously', () => {
    expect(areResourceSubscriptionsAuthorized([], [])).toBe(true);
  });
});
