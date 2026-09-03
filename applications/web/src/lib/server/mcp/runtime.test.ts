import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createOAuthStores } from '@tribunal/database/queries';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import type { SvelteKitMcpRuntime } from '@lostgradient/mcp/sveltekit';
import { mcpLogger } from '$lib/server/mcp-logger';
import { mcpSlidingWindowStore } from '$lib/server/oauth/configuration';
import {
  createTribunalMcpRuntime,
  logAuthenticationEvent,
  logHandlerDegradation,
  logHandlerError,
  logHandlerEvent,
} from './runtime';

describe('runtime observability callbacks', () => {
  it('logs handler and authentication events through the shared logger', () => {
    const warn = vi.spyOn(mcpLogger, 'warn').mockImplementation(() => mcpLogger);
    const info = vi.spyOn(mcpLogger, 'info').mockImplementation(() => mcpLogger);
    const error = vi.spyOn(mcpLogger, 'error').mockImplementation(() => mcpLogger);

    logHandlerDegradation('single_instance_messaging_fallback');
    logHandlerEvent('insufficient_scope');
    logHandlerError(new Error('boom'), 'serve', 'user-1');
    logAuthenticationEvent('invalid_resource', 'req-1');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);

    warn.mockRestore();
    info.mockRestore();
    error.mockRestore();
  });
});

describe('runtime request handling', () => {
  let database: TestDatabase;
  let runtime: SvelteKitMcpRuntime;

  beforeAll(async () => {
    database = await createTestDatabase();
    runtime = createTribunalMcpRuntime(createOAuthStores(database.db));
    await runtime.start();
  });

  afterAll(async () => {
    await runtime.shutdown();
    await database.close();
  });

  it('rejects an unauthenticated /mcp request', async () => {
    const requestUrl = new URL('http://localhost:5173/mcp');
    const response = await runtime.handle({
      request: new Request(requestUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
        body: '{}',
      }),
      requestUrl,
      requestId: 'req-1',
      socketAddress: '127.0.0.1',
      identity: null,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('publishes a grant revocation without error', async () => {
    await expect(runtime.publishGrantRevocation('42')).resolves.toBeUndefined();
  });

  it('distinguishes requests by client address rather than collapsing them', async () => {
    const consume = vi.spyOn(mcpSlidingWindowStore, 'consume');

    const send = (socketAddress: string) => {
      const requestUrl = new URL('http://localhost:5173/mcp');
      return runtime.handle({
        request: new Request(requestUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
          body: '{}',
        }),
        requestUrl,
        requestId: 'req-addr',
        socketAddress,
        identity: null,
      });
    };

    await send('10.0.0.1');
    await send('10.0.0.2');

    const keys = consume.mock.calls.map(([input]) => input.key);
    expect(keys.some((key) => key.includes('10.0.0.1'))).toBe(true);
    expect(keys.some((key) => key.includes('10.0.0.2'))).toBe(true);
    consume.mockRestore();
  });
});
