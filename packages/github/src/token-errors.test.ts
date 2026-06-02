import { describe, it, expect } from 'vitest';
import {
  classifyTokenError,
  isRetryableTokenError,
  isInstallationTokenError,
  createRateLimitedError,
  createInstallationTokenError,
  NON_RETRYABLE_TOKEN_ERROR_CODES,
  type InstallationTokenErrorCode,
} from './token-errors';

describe('classifyTokenError', () => {
  const installationId = 12345;

  describe('rate limit errors', () => {
    it('classifies 429 as rate_limited with secondary flag', () => {
      expect.assertions(4);
      const error = Object.assign(new Error('Rate limit'), {
        status: 429,
        response: { headers: { 'retry-after': '60' } },
      });

      const result = classifyTokenError(error, installationId);

      expect(result.code).toBe('rate_limited');
      expect(result.installationId).toBe(installationId);
      expect(result.retryAfterSeconds).toBe(60);
      expect(result.isSecondaryLimit).toBe(true);
    });

    it('classifies 403 with rate limit message as rate_limited (primary)', () => {
      expect.assertions(3);
      const error = Object.assign(new Error('Rate limit'), {
        status: 403,
        response: { data: { message: 'API rate limit exceeded' } },
      });

      const result = classifyTokenError(error, installationId);

      expect(result.code).toBe('rate_limited');
      expect(result.isSecondaryLimit).toBe(false);
      expect(result.installationId).toBe(installationId);
    });

    it('classifies 403 with retry-after header as rate_limited (secondary)', () => {
      expect.assertions(4);
      const error = Object.assign(new Error('Abuse detection'), {
        status: 403,
        response: {
          data: { message: 'Abuse detection mechanism triggered' },
          headers: { 'retry-after': '120' },
        },
      });

      const result = classifyTokenError(error, installationId);

      expect(result.code).toBe('rate_limited');
      expect(result.isSecondaryLimit).toBe(true);
      expect(result.retryAfterSeconds).toBe(120);
      expect(result.installationId).toBe(installationId);
    });

    it('extracts retry-after from x-ratelimit-reset header', () => {
      expect.assertions(2);
      const futureTime = Math.floor(Date.now() / 1000) + 120;
      const error = Object.assign(new Error('Rate limit'), {
        status: 403,
        response: {
          data: { message: 'rate limit' },
          headers: { 'x-ratelimit-reset': String(futureTime) },
        },
      });

      const result = classifyTokenError(error, installationId);

      expect(result.code).toBe('rate_limited');
      expect(result.retryAfterSeconds).toBeGreaterThan(100);
    });
  });

  describe('not found errors', () => {
    it('classifies 404 as not_found', () => {
      expect.assertions(3);
      const error = Object.assign(new Error('Not Found'), { status: 404 });

      const result = classifyTokenError(error, installationId);

      expect(result.code).toBe('not_found');
      expect(result.installationId).toBe(installationId);
      expect(result.message).toContain('not found');
    });
  });

  describe('forbidden errors', () => {
    it('classifies 403 with suspended message as suspended', () => {
      expect.assertions(2);
      const error = Object.assign(new Error('Forbidden'), {
        status: 403,
        response: { data: { message: 'This installation has been suspended' } },
      });

      const result = classifyTokenError(error, installationId);

      expect(result.code).toBe('suspended');
      expect(result.installationId).toBe(installationId);
    });

    it('classifies 403 without rate limit as insufficient_permissions', () => {
      expect.assertions(2);
      const error = Object.assign(new Error('Forbidden'), {
        status: 403,
        response: { data: { message: 'Permission denied' } },
      });

      const result = classifyTokenError(error, installationId);

      expect(result.code).toBe('insufficient_permissions');
      expect(result.installationId).toBe(installationId);
    });
  });

  describe('unauthorized errors', () => {
    it('classifies 401 with revoked message as revoked', () => {
      expect.assertions(2);
      const error = Object.assign(new Error('Unauthorized'), {
        status: 401,
        response: { data: { message: 'Token has been revoked' } },
      });

      const result = classifyTokenError(error, installationId);

      expect(result.code).toBe('revoked');
      expect(result.installationId).toBe(installationId);
    });

    it('classifies 401 without revoked message as auth_failed', () => {
      expect.assertions(2);
      const error = Object.assign(new Error('Unauthorized'), {
        status: 401,
        response: { data: { message: 'Bad credentials' } },
      });

      const result = classifyTokenError(error, installationId);

      expect(result.code).toBe('auth_failed');
      expect(result.installationId).toBe(installationId);
    });
  });

  describe('unknown errors', () => {
    it('classifies non-Octokit errors as server_error (retryable)', () => {
      expect.assertions(2);
      const error = new Error('Some unknown error');

      const result = classifyTokenError(error, installationId);

      expect(result.code).toBe('server_error');
      expect(result.message).toContain('Some unknown error');
    });

    it('handles null/undefined errors gracefully as server_error', () => {
      expect.assertions(2);
      const result = classifyTokenError(null, installationId);

      expect(result.code).toBe('server_error');
      expect(result.installationId).toBe(installationId);
    });
  });
});

describe('isRetryableTokenError', () => {
  it('returns true for rate_limited', () => {
    expect.assertions(1);
    expect(isRetryableTokenError('rate_limited')).toBe(true);
  });

  it('returns true for server_error', () => {
    expect.assertions(1);
    expect(isRetryableTokenError('server_error')).toBe(true);
  });

  it('returns false for non-retryable codes', () => {
    expect.assertions(5);
    const nonRetryableCodes: InstallationTokenErrorCode[] = [
      'suspended',
      'not_found',
      'insufficient_permissions',
      'revoked',
      'auth_failed',
    ];

    for (const code of nonRetryableCodes) {
      expect(isRetryableTokenError(code)).toBe(false);
    }
  });
});

describe('NON_RETRYABLE_TOKEN_ERROR_CODES', () => {
  it('contains all non-retryable codes', () => {
    expect.assertions(7);
    expect(NON_RETRYABLE_TOKEN_ERROR_CODES).toContain('suspended');
    expect(NON_RETRYABLE_TOKEN_ERROR_CODES).toContain('not_found');
    expect(NON_RETRYABLE_TOKEN_ERROR_CODES).toContain('insufficient_permissions');
    expect(NON_RETRYABLE_TOKEN_ERROR_CODES).toContain('revoked');
    expect(NON_RETRYABLE_TOKEN_ERROR_CODES).toContain('auth_failed');
    expect(NON_RETRYABLE_TOKEN_ERROR_CODES).not.toContain('rate_limited');
    expect(NON_RETRYABLE_TOKEN_ERROR_CODES).not.toContain('server_error');
  });
});

describe('isInstallationTokenError', () => {
  it('returns true for valid InstallationTokenError', () => {
    expect.assertions(1);
    const error = {
      code: 'rate_limited' as const,
      message: 'Rate limited',
      installationId: 123,
      retryAfterSeconds: 60,
    };
    expect(isInstallationTokenError(error)).toBe(true);
  });

  it('returns false for missing required fields', () => {
    expect.assertions(4);
    expect(isInstallationTokenError(null)).toBe(false);
    expect(isInstallationTokenError({ code: 'rate_limited' })).toBe(false);
    expect(isInstallationTokenError({ code: 'rate_limited', message: 'test' })).toBe(false);
    expect(isInstallationTokenError({ message: 'test', installationId: 123 })).toBe(false);
  });

  it('returns false for wrong field types', () => {
    expect.assertions(1);
    const error = {
      code: 123, // Should be string
      message: 'test',
      installationId: 123,
    };
    expect(isInstallationTokenError(error)).toBe(false);
  });
});

describe('createRateLimitedError', () => {
  it('creates a rate limited error with all fields', () => {
    expect.assertions(5);
    const error = createRateLimitedError(123, 60, true);

    expect(error.code).toBe('rate_limited');
    expect(error.installationId).toBe(123);
    expect(error.retryAfterSeconds).toBe(60);
    expect(error.isSecondaryLimit).toBe(true);
    expect(error.message).toContain('60s');
  });

  it('defaults isSecondaryLimit to false', () => {
    expect.assertions(1);
    const error = createRateLimitedError(123, 30);
    expect(error.isSecondaryLimit).toBe(false);
  });
});

describe('createInstallationTokenError', () => {
  it('creates an error with the specified code', () => {
    expect.assertions(3);
    const error = createInstallationTokenError('suspended', 123, 'Installation suspended');

    expect(error.code).toBe('suspended');
    expect(error.installationId).toBe(123);
    expect(error.message).toBe('Installation suspended');
  });
});
