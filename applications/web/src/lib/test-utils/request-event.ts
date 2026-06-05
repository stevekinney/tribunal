/**
 * Test utilities for mocking SvelteKit RequestEvent objects.
 *
 * Used for testing form actions and server-side logic that depends on RequestEvent.
 */

import type { RequestEvent } from '@sveltejs/kit';

/**
 * Create a FormData instance from a plain object.
 * Useful for testing form action handlers.
 */
export function createFormDataFromObject(data: Record<string, string | number>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(data)) {
    formData.append(key, String(value));
  }
  return formData;
}

/**
 * Options for creating a mock RequestEvent.
 */
export interface MockRequestEventOptions {
  /** URL for the request (default: http://localhost/) */
  url?: string;
  /** HTTP method (default: GET) */
  method?: string;
  /** Headers to include in the request */
  headers?: Record<string, string>;
  /** FormData or object to convert to FormData */
  body?: FormData | Record<string, string | number>;
  /**
   * Mocked locals object.
   * Note: In production, App.Locals has nullable user/neonSession fields.
   * This helper accepts any shape to support various test scenarios.
   */
  locals?: Record<string, unknown>;
  /** Route ID for SvelteKit routing (default: /(authenticated)/repositories) */
  routeId?: string;
  /** Route params extracted from URL (default: {}) */
  params?: Record<string, string>;
}

/**
 * Create a mock RequestEvent for testing SvelteKit server functions.
 *
 * Usage:
 * ```typescript
 * const event = createMockRequestEvent({
 *   url: 'http://localhost/api-keys',
 *   method: 'POST',
 *   body: { name: 'Test Key' },
 *   locals: { user: { id: 1, email: 'test@example.com', name: 'Test User' } }
 * });
 * ```
 */
export function createMockRequestEvent(options: MockRequestEventOptions = {}): RequestEvent {
  const {
    url = 'http://localhost/',
    method = 'GET',
    headers = {},
    body,
    locals = {},
    routeId = '/(authenticated)/repositories',
    params = {},
  } = options;

  // Convert body object to FormData if needed
  const formData =
    body instanceof FormData ? body : body ? createFormDataFromObject(body) : new FormData();

  const request = new Request(url, {
    method,
    headers: new Headers(headers),
    body: method !== 'GET' && method !== 'HEAD' ? formData : undefined,
  });

  return {
    request,
    url: new URL(url),
    params,
    route: { id: routeId as string },
    locals: locals as unknown as App.Locals,
    cookies: {
      get: () => undefined,
      getAll: () => [],
      set: () => {},
      delete: () => {},
      serialize: () => '',
    },
    fetch: globalThis.fetch,
    getClientAddress: () => '127.0.0.1',
    platform: undefined,
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    depends: () => {},
    parent: async () => ({}),
    untrack: <T>(fn: () => T) => fn(),
    tracing: { enabled: false, root: null, current: null },
  } as RequestEvent;
}
