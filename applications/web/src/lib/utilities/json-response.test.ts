import { describe, it, expect, vi, type Mock } from 'vitest';
import { error, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
  isApiRoute,
  isInternalApiRoute,
  httpStatusToCode,
  createJsonErrorResponse,
  respondWithJsonForApiEndpoints,
} from './json-response';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock event with the given pathname. */
function createMockEvent(pathname: string): RequestEvent {
  return { url: new URL(`https://test.example.com${pathname}`) } as unknown as RequestEvent;
}

/** Create a resolve function that returns the given response. */
function createResolve(response: Response): Mock {
  return vi.fn().mockResolvedValue(response);
}

/** Create a resolve function that throws the given error. */
function createThrowingResolve(thrown: unknown): Mock {
  return vi.fn().mockRejectedValue(thrown);
}

/** Parse the JSON body of a Response. */
async function parseBody(response: Response): Promise<unknown> {
  return JSON.parse(await response.text());
}

// ---------------------------------------------------------------------------
// Helper unit tests
// ---------------------------------------------------------------------------

describe('isApiRoute', () => {
  it('returns true for /api/example/foo', () => {
    expect(isApiRoute('/api/example/foo')).toBe(true);
  });

  it('returns true for /api/internal/example/bar', () => {
    expect(isApiRoute('/api/internal/example/bar')).toBe(true);
  });

  it('returns true for /api/webhooks/github', () => {
    expect(isApiRoute('/api/webhooks/github')).toBe(true);
  });

  it('returns false for /settings', () => {
    expect(isApiRoute('/settings')).toBe(false);
  });

  it('returns true for /api (root path)', () => {
    expect(isApiRoute('/api')).toBe(true);
  });
});

describe('isInternalApiRoute', () => {
  it('returns true for /api/internal/example/foo', () => {
    expect(isInternalApiRoute('/api/internal/example/foo')).toBe(true);
  });

  it('returns false for /api/example/foo', () => {
    expect(isInternalApiRoute('/api/example/foo')).toBe(false);
  });
});

describe('httpStatusToCode', () => {
  it.each([
    [400, 'BAD_REQUEST'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [405, 'METHOD_NOT_ALLOWED'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [500, 'INTERNAL_SERVER_ERROR'],
  ])('maps %d to %s', (status, expected) => {
    expect(httpStatusToCode(status)).toBe(expected);
  });

  it('falls back to HTTP_ERROR_{n} for unmapped statuses', () => {
    expect(httpStatusToCode(418)).toBe('HTTP_ERROR_418');
  });
});

describe('createJsonErrorResponse', () => {
  it('returns a Response with correct status', async () => {
    const response = createJsonErrorResponse(413, 'Payload too large');
    expect(response.status).toBe(413);
  });

  it('sets content-type to application/json', async () => {
    const response = createJsonErrorResponse(413, 'Payload too large');
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('has the correct JSON envelope shape', async () => {
    const response = createJsonErrorResponse(413, 'Payload too large');
    const body = await parseBody(response);
    expect(body).toEqual({
      ok: false,
      error: {
        message: 'Payload too large',
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
      },
    });
  });

  it('forwards Set-Cookie headers from original response', () => {
    const original = new Response('', {
      status: 404,
      headers: { 'set-cookie': 'session=abc; Path=/' },
    });
    const result = createJsonErrorResponse(404, 'Not found', original);
    expect(result.headers.get('set-cookie')).toBe('session=abc; Path=/');
    expect(result.headers.get('content-type')).toBe('application/json');
  });

  it('forwards Allow header from original response', () => {
    const original = new Response('', {
      status: 405,
      headers: { allow: 'GET, POST' },
    });
    const result = createJsonErrorResponse(405, 'Method not allowed', original);
    expect(result.headers.get('allow')).toBe('GET, POST');
  });

  it('does not add headers when no original response is provided', () => {
    const result = createJsonErrorResponse(500, 'Internal server error');
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(result.headers.get('allow')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Handle integration tests
// ---------------------------------------------------------------------------

describe('apiJsonHandle', () => {
  describe('non-API routes', () => {
    it('passes through unchanged', async () => {
      const event = createMockEvent('/settings');
      const expected = new Response('HTML page', { status: 200 });
      const resolve = createResolve(expected);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result).toBe(expected);
    });
  });

  describe('API routes with JSON responses', () => {
    it('passes through a JSON success response unchanged', async () => {
      const event = createMockEvent('/api/example/foo');
      const expected = new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      const resolve = createResolve(expected);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result).toBe(expected);
    });
  });

  describe('API routes with non-JSON error responses', () => {
    it('converts a non-JSON 404 to JSON 404', async () => {
      const event = createMockEvent('/api/example/nonexistent');
      const htmlResponse = new Response('<h1>Not Found</h1>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      });
      const resolve = createResolve(htmlResponse);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(404);
      expect(result.headers.get('content-type')).toBe('application/json');
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: { message: 'Not found', status: 404, code: 'NOT_FOUND' },
      });
    });

    it('converts a non-JSON 405 to JSON 405', async () => {
      const event = createMockEvent('/api/webhooks/github');
      const textResponse = new Response('Method Not Allowed', {
        status: 405,
        headers: { 'content-type': 'text/plain' },
      });
      const resolve = createResolve(textResponse);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(405);
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: { message: 'Method not allowed', status: 405, code: 'METHOD_NOT_ALLOWED' },
      });
    });

    it('preserves Set-Cookie from original non-JSON error response', async () => {
      const event = createMockEvent('/api/example/foo');
      const original = new Response('<h1>Not Found</h1>', {
        status: 404,
        headers: {
          'content-type': 'text/html',
          'set-cookie': 'session=refreshed; Path=/',
        },
      });
      const resolve = createResolve(original);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(404);
      expect(result.headers.get('content-type')).toBe('application/json');
      expect(result.headers.get('set-cookie')).toBe('session=refreshed; Path=/');
    });

    it('preserves Allow header from original non-JSON 405 response', async () => {
      const event = createMockEvent('/api/webhooks/github');
      const original = new Response('Method Not Allowed', {
        status: 405,
        headers: {
          'content-type': 'text/plain',
          allow: 'POST',
        },
      });
      const resolve = createResolve(original);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(405);
      expect(result.headers.get('allow')).toBe('POST');
    });
  });

  describe('API routes with non-JSON success responses', () => {
    it('passes through non-JSON success responses unchanged (binary/streaming)', async () => {
      const event = createMockEvent('/api/example/foo');
      const binaryResponse = new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
      const resolve = createResolve(binaryResponse);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result).toBe(binaryResponse);
    });
  });

  describe('HttpError handling', () => {
    it('converts HttpError(413) to JSON 413 with message', async () => {
      const event = createMockEvent('/api/webhooks/github');
      let thrown: unknown;
      try {
        error(413, 'Payload too large');
      } catch (e) {
        thrown = e;
      }
      const resolve = createThrowingResolve(thrown);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(413);
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: { message: 'Payload too large', status: 413, code: 'PAYLOAD_TOO_LARGE' },
      });
    });

    it('converts HttpError(401) to JSON 401 with message', async () => {
      const event = createMockEvent('/api/webhooks/github');
      let thrown: unknown;
      try {
        error(401, 'Invalid webhook signature');
      } catch (e) {
        thrown = e;
      }
      const resolve = createThrowingResolve(thrown);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(401);
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: { message: 'Invalid webhook signature', status: 401, code: 'UNAUTHORIZED' },
      });
    });

    it('converts HttpError(500) to JSON 500 with message', async () => {
      const event = createMockEvent('/api/webhooks/github');
      let thrown: unknown;
      try {
        error(500, 'Webhook secret not configured');
      } catch (e) {
        thrown = e;
      }
      const resolve = createThrowingResolve(thrown);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(500);
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: {
          message: 'Webhook secret not configured',
          status: 500,
          code: 'INTERNAL_SERVER_ERROR',
        },
      });
    });
  });

  describe('unknown error handling', () => {
    it('converts non-HttpError to JSON 500 with generic message', async () => {
      const event = createMockEvent('/api/example/foo');
      const resolve = createThrowingResolve(new Error('something broke'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      consoleSpy.mockRestore();

      expect(result.status).toBe(500);
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: { message: 'Internal server error', status: 500, code: 'INTERNAL_SERVER_ERROR' },
      });
    });
  });

  describe('redirect handling', () => {
    it('re-throws redirects', async () => {
      const event = createMockEvent('/api/example/foo');
      let thrown: unknown;
      try {
        redirect(307, '/login');
      } catch (e) {
        thrown = e;
      }
      const resolve = createThrowingResolve(thrown);

      await expect(respondWithJsonForApiEndpoints({ event, resolve })).rejects.toBe(thrown);
    });
  });

  describe('internal API masking', () => {
    it('remaps JSON 401 response to JSON 404', async () => {
      const event = createMockEvent('/api/internal/example/foo');
      const unauthorizedResponse = new Response('{"error":"Unauthorized"}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
      const resolve = createResolve(unauthorizedResponse);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(404);
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: { message: 'Not found', status: 404, code: 'NOT_FOUND' },
      });
    });

    it('remaps JSON 403 response to JSON 404', async () => {
      const event = createMockEvent('/api/internal/example/foo');
      const forbiddenResponse = new Response('{"error":"Forbidden"}', {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
      const resolve = createResolve(forbiddenResponse);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(404);
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: { message: 'Not found', status: 404, code: 'NOT_FOUND' },
      });
    });

    it('remaps HttpError(401) to JSON 404', async () => {
      const event = createMockEvent('/api/internal/example/foo');
      let thrown: unknown;
      try {
        error(401, 'Unauthorized');
      } catch (e) {
        thrown = e;
      }
      const resolve = createThrowingResolve(thrown);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(404);
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: { message: 'Not found', status: 404, code: 'NOT_FOUND' },
      });
    });

    it('passes through JSON 200 response unchanged', async () => {
      const event = createMockEvent('/api/internal/example/foo');
      const successResponse = new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      const resolve = createResolve(successResponse);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result).toBe(successResponse);
    });

    it('remaps JSON 500 response to JSON 404 (all errors masked on internal routes)', async () => {
      const event = createMockEvent('/api/internal/example/foo');
      const serverErrorResponse = new Response('{"error":"Internal"}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
      const resolve = createResolve(serverErrorResponse);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(404);
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: { message: 'Not found', status: 404, code: 'NOT_FOUND' },
      });
    });

    it('remaps non-JSON 405 to JSON 404 (prevents route probing)', async () => {
      const event = createMockEvent('/api/internal/example/foo');
      const methodNotAllowed = new Response('Method Not Allowed', {
        status: 405,
        headers: { 'content-type': 'text/plain', allow: 'GET, POST' },
      });
      const resolve = createResolve(methodNotAllowed);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(404);
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: { message: 'Not found', status: 404, code: 'NOT_FOUND' },
      });
    });

    it('remaps HttpError(500) to JSON 404 on internal routes', async () => {
      const event = createMockEvent('/api/internal/example/foo');
      let thrown: unknown;
      try {
        error(500, 'Something broke');
      } catch (e) {
        thrown = e;
      }
      const resolve = createThrowingResolve(thrown);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(404);
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: { message: 'Not found', status: 404, code: 'NOT_FOUND' },
      });
    });

    it('remaps unknown errors to JSON 404 on internal routes', async () => {
      const event = createMockEvent('/api/internal/example/foo');
      const resolve = createThrowingResolve(new Error('unexpected'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      consoleSpy.mockRestore();

      expect(result.status).toBe(404);
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: { message: 'Not found', status: 404, code: 'NOT_FOUND' },
      });
    });

    it('remaps non-JSON 401 response to JSON 404', async () => {
      const event = createMockEvent('/api/internal/example/foo');
      const htmlResponse = new Response('<h1>Unauthorized</h1>', {
        status: 401,
        headers: { 'content-type': 'text/html' },
      });
      const resolve = createResolve(htmlResponse);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(404);
      const body = await parseBody(result);
      expect(body).toEqual({
        ok: false,
        error: { message: 'Not found', status: 404, code: 'NOT_FOUND' },
      });
    });

    it('does NOT forward Allow header when masking internal 405 as 404', async () => {
      const event = createMockEvent('/api/internal/example/foo');
      const original = new Response('Method Not Allowed', {
        status: 405,
        headers: {
          'content-type': 'text/plain',
          allow: 'GET, POST',
        },
      });
      const resolve = createResolve(original);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(404);
      expect(result.headers.get('allow')).toBeNull();
    });

    it('does NOT forward any original headers when masking internal errors', async () => {
      const event = createMockEvent('/api/internal/example/foo');
      const original = new Response('{"error":"Unauthorized"}', {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'session=deleted; Path=/; Max-Age=0',
          'access-control-allow-origin': '*',
        },
      });
      const resolve = createResolve(original);

      const result = await respondWithJsonForApiEndpoints({ event, resolve });
      expect(result.status).toBe(404);
      expect(result.headers.get('set-cookie')).toBeNull();
      expect(result.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
