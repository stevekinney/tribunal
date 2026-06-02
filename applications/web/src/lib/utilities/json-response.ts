/**
 * SvelteKit handle hook that enforces JSON-only responses for /api/** routes.
 *
 * Catches HttpError exceptions, normalizes non-JSON error responses, and masks
 * all error responses on internal API routes as 404 to hide the API surface.
 */

import type { Handle } from '@sveltejs/kit';
import { isHttpError, isRedirect } from '@sveltejs/kit';

const STATUS_CODE_MAP: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

const DEFAULT_STATUS_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  413: 'Payload too large',
  500: 'Internal server error',
};

/** Returns true if the pathname is `/api` or starts with `/api/`. */
export function isApiRoute(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/** Returns true if the pathname starts with `/api/internal/`. */
export function isInternalApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/internal/');
}

/** Maps an HTTP status code to a machine-readable error code string. */
export function httpStatusToCode(status: number): string {
  return STATUS_CODE_MAP[status] ?? `HTTP_ERROR_${status}`;
}

/**
 * Headers that should be forwarded from the original response when replacing
 * its body with a JSON error envelope. These are headers that downstream
 * middleware (e.g. authHandle) or the framework may have set and that clients
 * or browsers depend on.
 */
const FORWARDED_HEADERS = ['set-cookie', 'allow', 'access-control-allow-origin'];

/**
 * Builds a JSON error `Response` with a standard envelope shape.
 * When `originalResponse` is provided, forwards important headers
 * (Set-Cookie, Allow, CORS) from it onto the new response.
 */
export function createJsonErrorResponse(
  status: number,
  message: string,
  originalResponse?: Response,
): Response {
  const response = new Response(
    JSON.stringify({
      ok: false,
      error: {
        message,
        status,
        code: httpStatusToCode(status),
      },
    }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );

  if (originalResponse) {
    for (const name of FORWARDED_HEADERS) {
      const values = originalResponse.headers.getSetCookie
        ? name === 'set-cookie'
          ? originalResponse.headers.getSetCookie()
          : [originalResponse.headers.get(name)].filter(Boolean)
        : [originalResponse.headers.get(name)].filter(Boolean);

      for (const value of values) {
        if (value) response.headers.append(name, value);
      }
    }
  }

  return response;
}

/**
 * If the route is internal and the status indicates an error, mask it as a 404
 * to prevent route probing (e.g. a 405 revealing which methods a route accepts).
 * Returns null if no masking is needed.
 *
 * Intentionally does NOT forward headers from the original response: headers
 * like `Allow` or CORS would leak route existence information, defeating the
 * masking. Internal API routes are service-to-service and don't use cookies.
 */
function maybeMaskInternalError(isInternal: boolean, status: number): Response | null {
  if (isInternal && status >= 400) {
    return createJsonErrorResponse(404, 'Not found');
  }
  return null;
}

/**
 * SvelteKit handle hook that wraps all `/api/**` request processing,
 * catches errors, and normalizes all error responses to JSON.
 */
export const respondWithJsonForApiEndpoints: Handle = async ({ event, resolve }) => {
  const pathname = event.url.pathname;

  if (!isApiRoute(pathname)) {
    return resolve(event);
  }

  const isInternal = isInternalApiRoute(pathname);

  try {
    const response = await resolve(event);
    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');

    if (isJson) {
      return maybeMaskInternalError(isInternal, response.status) ?? response;
    }

    // Non-JSON error responses (framework HTML 404, text/plain 405, etc.)
    if (response.status >= 400) {
      const masked = maybeMaskInternalError(isInternal, response.status);
      if (masked) return masked;

      const message = DEFAULT_STATUS_MESSAGES[response.status] ?? `HTTP error ${response.status}`;
      return createJsonErrorResponse(response.status, message, response);
    }

    // Non-JSON success responses pass through (binary/streaming)
    return response;
  } catch (thrown) {
    if (isRedirect(thrown)) {
      throw thrown;
    }

    if (isHttpError(thrown)) {
      const status = thrown.status;
      const message =
        typeof thrown.body?.message === 'string'
          ? thrown.body.message
          : (DEFAULT_STATUS_MESSAGES[status] ?? `HTTP error ${status}`);

      const masked = maybeMaskInternalError(isInternal, status);
      if (masked) return masked;

      return createJsonErrorResponse(status, message);
    }

    // Unknown error
    console.error('[respondWithJsonForApiEndpoints] Unexpected error on', pathname, thrown);
    const masked = maybeMaskInternalError(isInternal, 500);
    if (masked) return masked;
    return createJsonErrorResponse(500, 'Internal server error');
  }
};
