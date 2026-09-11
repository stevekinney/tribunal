import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({ MCP_OPERATIONS_TOKEN: undefined as string | undefined }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { authorizeOperationsRequest, operationsUnauthorizedResponse } =
  await import('./operations-auth');

function requestWithBearer(token?: string): Request {
  return new Request('http://localhost/metrics', {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

describe('authorizeOperationsRequest', () => {
  beforeEach(() => {
    mockEnv.MCP_OPERATIONS_TOKEN = undefined;
  });

  it('fails closed with 503 when no token is configured', () => {
    mockEnv.MCP_OPERATIONS_TOKEN = undefined;
    expect(authorizeOperationsRequest(requestWithBearer('anything'))).toEqual({
      authorized: false,
      status: 503,
      reason: expect.stringContaining('MCP_OPERATIONS_TOKEN'),
    });
  });

  it('authorizes a correct bearer token', () => {
    mockEnv.MCP_OPERATIONS_TOKEN = 'super-secret-token';
    expect(authorizeOperationsRequest(requestWithBearer('super-secret-token'))).toEqual({
      authorized: true,
    });
  });

  it('rejects a wrong bearer token with 401', () => {
    mockEnv.MCP_OPERATIONS_TOKEN = 'super-secret-token';
    expect(authorizeOperationsRequest(requestWithBearer('wrong')).authorized).toBe(false);
    expect(authorizeOperationsRequest(requestWithBearer('wrong'))).toMatchObject({ status: 401 });
  });

  it('rejects a missing Authorization header with 401', () => {
    mockEnv.MCP_OPERATIONS_TOKEN = 'super-secret-token';
    expect(authorizeOperationsRequest(requestWithBearer())).toMatchObject({
      authorized: false,
      status: 401,
    });
  });

  it('rejects a same-length but different token (constant-time path returns false)', () => {
    mockEnv.MCP_OPERATIONS_TOKEN = 'aaaaaaaa';
    expect(authorizeOperationsRequest(requestWithBearer('bbbbbbbb')).authorized).toBe(false);
  });
});

describe('operationsUnauthorizedResponse', () => {
  it('carries Cache-Control: no-store and the denial status/body', async () => {
    const response = operationsUnauthorizedResponse({
      authorized: false,
      status: 401,
      reason: 'invalid or missing operational bearer token',
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: 'unauthorized',
      error_description: 'invalid or missing operational bearer token',
    });
  });

  it('maps a 503 (unconfigured) to the unavailable error code', async () => {
    const response = operationsUnauthorizedResponse({
      authorized: false,
      status: 503,
      reason: 'operational endpoints unavailable: MCP_OPERATIONS_TOKEN is not configured',
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('unavailable');
  });
});
