import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import {
  cacheControlOn404Handle,
  createMcpIdentityHandle,
  createMcpMountHandle,
} from './mount-hooks';

function fakeEvent(pathname = '/mcp'): RequestEvent {
  const url = new URL(`http://localhost${pathname}`);
  return {
    request: new Request(url),
    url,
    locals: { user: null, requestId: 'req-test' },
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent;
}

const respondWith = (status: number) => () => Promise.resolve(new Response('body', { status }));

describe('cacheControlOn404Handle', () => {
  it('adds Cache-Control: no-store to a 404 response', async () => {
    const response = await cacheControlOn404Handle({
      event: fakeEvent(),
      resolve: respondWith(404),
    } as never);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('leaves a non-404 response unchanged', async () => {
    const response = await cacheControlOn404Handle({
      event: fakeEvent(),
      resolve: respondWith(200),
    } as never);
    expect(response.headers.get('cache-control')).toBeNull();
  });
});

describe('MCP handles when the surface is disabled', () => {
  it('the mount handle falls through to resolve (ordinary 404)', async () => {
    const handle = createMcpMountHandle(() => null);
    const resolve = vi.fn(respondWith(404));
    const response = await handle({ event: fakeEvent('/oauth/authorize'), resolve } as never);
    expect(resolve).toHaveBeenCalledOnce();
    expect(response.status).toBe(404);
  });

  it('the identity handle does not prime and continues the chain', async () => {
    const handle = createMcpIdentityHandle(() => null);
    const resolve = vi.fn(respondWith(200));
    await handle({ event: fakeEvent(), resolve } as never);
    expect(resolve).toHaveBeenCalledOnce();
  });
});
