import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  PermissionError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
} from '../error-taxonomy.js';
import { classifyGitHubWriteError, withGitHubWriteErrorClassification } from './errors.js';

function octokitError(
  status: number,
  message: string,
  headers: Record<string, string> = {},
): Error & {
  status: number;
  response: { data: { message: string }; headers: Record<string, string> };
} {
  return Object.assign(new Error(message), {
    status,
    response: {
      data: { message },
      headers,
    },
  });
}

describe('classifyGitHubWriteError', () => {
  it('maps rate limits to retryable RateLimitError with retry timing', () => {
    const error = octokitError(429, 'secondary rate limit', { 'Retry-After': '12' });

    const classified = classifyGitHubWriteError(error);

    expect(classified).toBeInstanceOf(RateLimitError);
    expect(classified.message).toContain('GitHub API rate limit exceeded');
    expect((classified as RateLimitError).retryAfterSeconds).toBe(12);
  });

  it.each([
    [422, ValidationError, 'GitHub rejected the request'],
    [401, PermissionError, 'GitHub permission denied'],
    [403, PermissionError, 'GitHub permission denied'],
    [404, ValidationError, 'GitHub resource not found'],
    [409, ConflictError, 'GitHub resource conflict'],
    [503, ServiceUnavailableError, 'status 503'],
  ])('maps status %s to %s', (status, expectedError, message) => {
    const classified = classifyGitHubWriteError(octokitError(status, `status ${status}`));

    expect(classified).toBeInstanceOf(expectedError);
    expect(classified.message).toContain(message);
  });

  it('preserves regular Error instances and wraps non-Error values', () => {
    const original = new Error('boom');

    expect(classifyGitHubWriteError(original)).toBe(original);
    expect(classifyGitHubWriteError('plain failure').message).toBe('plain failure');
  });
});

describe('withGitHubWriteErrorClassification', () => {
  it('returns successful operation results', async () => {
    await expect(withGitHubWriteErrorClassification(async () => 'ok')).resolves.toBe('ok');
  });

  it('throws classified GitHub write errors', async () => {
    await expect(
      withGitHubWriteErrorClassification(async () => {
        throw octokitError(404, 'missing');
      }),
    ).rejects.toThrow(ValidationError);
  });
});
