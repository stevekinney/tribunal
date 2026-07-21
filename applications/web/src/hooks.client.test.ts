import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleError } from './hooks.client';

describe('handleClientError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('logs the client error and returns a generic message with an error code', () => {
    const error = new Error('boom');
    const result = handleError({
      error,
      event: { url: new URL('http://localhost/repositories') },
      status: 500,
      message: 'Internal Error',
    } as never);

    expect(console.error).toHaveBeenCalledWith(
      '[client error]',
      expect.objectContaining({ status: 500, message: 'Internal Error', error }),
    );
    expect(result).toEqual({ message: 'Internal Error', code: 'CLIENT_ERROR' });
  });

  it('falls back to a default message when none is provided', () => {
    const result = handleError({
      error: new Error('boom'),
      event: { url: new URL('http://localhost/') },
      status: 500,
      message: undefined,
    } as never) as { message: string; code: string };

    expect(result.message).toBe('An unexpected error occurred');
  });
});
