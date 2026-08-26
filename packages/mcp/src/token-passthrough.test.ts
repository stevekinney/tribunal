import { afterEach, describe, expect, it } from 'vitest';
import { allTools, conformanceOnlyTools } from './tools/index.js';
import { allResources } from './resources/index.js';
import { allPrompts } from './prompts/index.js';
import { createTestContext } from './testing/context.js';

/**
 * SEC-002: "Never pass connector tokens through to downstream services."
 *
 * This server has no downstream service call today that could carry a
 * connector's bearer token -- but that guarantee is architectural, not
 * incidental, and this file is what turns "architectural" into something a
 * regression can actually break:
 *
 * 1. `McpContext` (`types/primitives.ts`) never carries the raw access
 *    token in the first place -- only `userId` and a re-fetched
 *    `McpUserProfile`. A handler cannot forward what it was never handed.
 *    `contextNeverExposesToken` below asserts that shape directly.
 * 2. Every registered tool/resource/prompt handler is invoked here with a
 *    `fetch` spy installed. None of them make any outbound network call
 *    today; if a future tool or resource starts fetching a downstream API,
 *    this test starts failing the moment it does, forcing that addition to
 *    either not need the connector's own token (the common case) or to
 *    exchange for a separately-scoped downstream credential instead of
 *    forwarding the one this server issued.
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installFetchSpy(): { calls: unknown[][] } {
  const calls: unknown[][] = [];
  globalThis.fetch = (...args: unknown[]) => {
    calls.push(args);
    throw new Error('Unexpected outbound fetch call during a tool/resource/prompt handler');
  };
  return { calls };
}

describe('token passthrough prevention', () => {
  it('McpContext never exposes a raw token field a handler could forward downstream', () => {
    const context = createTestContext();
    const contextKeys = Object.keys(context);
    for (const forbiddenKey of ['token', 'accessToken', 'access_token', 'bearerToken']) {
      expect(contextKeys).not.toContain(forbiddenKey);
    }
    // The user profile itself is also token-free -- only display fields.
    expect(Object.keys(context.user)).toEqual(['id', 'email', 'name', 'image', 'role']);
  });

  it('every production tool handler makes zero outbound fetch calls', async () => {
    const { calls } = installFetchSpy();
    for (const tool of allTools) {
      await tool.handler(tool.inputSchema.parse({}), createTestContext());
    }
    expect(calls).toHaveLength(0);
  });

  it('every conformance-only tool handler makes zero outbound fetch calls', async () => {
    const { calls } = installFetchSpy();
    for (const tool of conformanceOnlyTools) {
      await tool.handler(tool.inputSchema.parse({}), createTestContext());
    }
    expect(calls).toHaveLength(0);
  });

  it('every resource handler makes zero outbound fetch calls', async () => {
    const { calls } = installFetchSpy();
    for (const resource of allResources) {
      await resource.handler(new URL(resource.uri), createTestContext());
    }
    expect(calls).toHaveLength(0);
  });

  it('every prompt handler makes zero outbound fetch calls', async () => {
    const { calls } = installFetchSpy();
    for (const prompt of allPrompts) {
      const sampleArguments = Object.fromEntries(
        Object.keys(prompt.arguments ?? {}).map((key) => [key, 'sample']),
      );
      await prompt.handler(sampleArguments, createTestContext());
    }
    expect(calls).toHaveLength(0);
  });
});
