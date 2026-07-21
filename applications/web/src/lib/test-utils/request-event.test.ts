import { describe, expect, it } from 'vitest';
import { createFormDataFromObject, createMockRequestEvent } from './request-event';

describe('createFormDataFromObject', () => {
  it('converts a plain object into FormData entries, stringifying numbers', () => {
    const formData = createFormDataFromObject({ name: 'Test Key', count: 3 });

    expect(formData.get('name')).toBe('Test Key');
    expect(formData.get('count')).toBe('3');
  });
});

describe('createMockRequestEvent', () => {
  it('defaults to a GET request to http://localhost/ with no locals or params', () => {
    const event = createMockRequestEvent();

    expect(event.request.method).toBe('GET');
    expect(event.url.toString()).toBe('http://localhost/');
    expect(event.params).toEqual({});
    expect(event.route.id).toBe('/(authenticated)/repositories');
    expect(event.locals).toEqual({});
  });

  it('builds a request with headers and a plain-object body converted to FormData', async () => {
    const event = createMockRequestEvent({
      url: 'http://localhost/api-keys',
      method: 'POST',
      headers: { 'x-test': 'true' },
      body: { name: 'Test Key' },
      locals: { user: { id: 1 } },
      routeId: '/(authenticated)/api-keys',
      params: { id: '1' },
    });

    expect(event.request.method).toBe('POST');
    expect(event.request.headers.get('x-test')).toBe('true');
    expect(event.route.id).toBe('/(authenticated)/api-keys');
    expect(event.params).toEqual({ id: '1' });
    expect(event.locals).toEqual({ user: { id: 1 } });

    const submittedFormData = await event.request.clone().formData();
    expect(submittedFormData.get('name')).toBe('Test Key');
  });

  it('accepts a FormData instance directly without re-wrapping it', async () => {
    const formData = new FormData();
    formData.set('name', 'Direct FormData');

    const event = createMockRequestEvent({ method: 'POST', body: formData });

    const submittedFormData = await event.request.clone().formData();
    expect(submittedFormData.get('name')).toBe('Direct FormData');
  });

  it('sends no body for GET and HEAD requests even when a body is provided', () => {
    const getEvent = createMockRequestEvent({ method: 'GET', body: { name: 'ignored' } });
    const headEvent = createMockRequestEvent({ method: 'HEAD', body: { name: 'ignored' } });

    expect(getEvent.request.body).toBeNull();
    expect(headEvent.request.body).toBeNull();
  });

  it('provides cookie, fetch, and lifecycle stubs sufficient for SvelteKit server code', async () => {
    const event = createMockRequestEvent() as unknown as {
      cookies: {
        get: (name: string) => string | undefined;
        getAll: () => unknown[];
        set: (name: string, value: string, options: unknown) => void;
        delete: (name: string, options: unknown) => void;
        serialize: (name: string, value: string, options: unknown) => string;
      };
      getClientAddress: () => string;
      isDataRequest: boolean;
      isSubRequest: boolean;
      isRemoteRequest: boolean;
      depends: (...deps: string[]) => void;
      parent: () => Promise<Record<string, never>>;
      untrack: <T>(fn: () => T) => T;
      tracing: { enabled: boolean; root: unknown; current: unknown };
      setHeaders: (headers: Record<string, string>) => void;
    };

    expect(event.cookies.get('anything')).toBeUndefined();
    expect(event.cookies.getAll()).toEqual([]);
    expect(() => event.cookies.set('a', 'b', { path: '/' })).not.toThrow();
    expect(() => event.cookies.delete('a', { path: '/' })).not.toThrow();
    expect(event.cookies.serialize('a', 'b', { path: '/' })).toBe('');
    expect(event.getClientAddress()).toBe('127.0.0.1');
    expect(event.isDataRequest).toBe(false);
    expect(event.isSubRequest).toBe(false);
    expect(event.isRemoteRequest).toBe(false);
    expect(() => event.depends('app:test')).not.toThrow();
    await expect(event.parent()).resolves.toEqual({});
    expect(event.untrack(() => 42)).toBe(42);
    expect(event.tracing).toEqual({ enabled: false, root: null, current: null });
    expect(() => event.setHeaders({ 'x-test': 'true' })).not.toThrow();
  });
});
