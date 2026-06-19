import { describe, it, expect } from 'vitest';
import {
  isOctokitRequestError,
  isRateLimitError,
  isNotFoundError,
  isValidationError,
  isForbiddenError,
  isUnauthorizedError,
  getErrorMessage,
  getRateLimitRetryAfter,
  isGraphQLResponseError,
  extractGraphQLErrors,
  isGraphQLNotFoundError,
  isGraphQLForbiddenError,
  isGraphQLRateLimitError,
  getGraphQLErrorMessage,
  parseValidationErrorReason,
} from './errors';

describe('isOctokitRequestError', () => {
  it('returns false for non-Error values', () => {
    expect.assertions(4);
    expect(isOctokitRequestError(null)).toBe(false);
    expect(isOctokitRequestError(undefined)).toBe(false);
    expect(isOctokitRequestError('error string')).toBe(false);
    expect(isOctokitRequestError({ status: 404 })).toBe(false);
  });

  it('returns false for Error without status', () => {
    expect.assertions(1);
    expect(isOctokitRequestError(new Error('Some error'))).toBe(false);
  });

  it('returns true for Error with numeric status', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Not Found'), { status: 404 });
    expect(isOctokitRequestError(error)).toBe(true);
  });
});

describe('isRateLimitError', () => {
  it('returns false for non-Octokit errors', () => {
    expect.assertions(2);
    expect(isRateLimitError(new Error('Some error'))).toBe(false);
    expect(isRateLimitError({ status: 429 })).toBe(false);
  });

  it('returns true for 429 status', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Rate limit'), { status: 429 });
    expect(isRateLimitError(error)).toBe(true);
  });

  it('returns true for 403 with rate limit message', () => {
    expect.assertions(2);
    const error = Object.assign(new Error('Rate limit'), {
      status: 403,
      response: { data: { message: 'API rate limit exceeded for user' } },
    });
    expect(isRateLimitError(error)).toBe(true);

    const errorSecondary = Object.assign(new Error('Rate limit'), {
      status: 403,
      response: { data: { message: 'secondary rate limit' } },
    });
    expect(isRateLimitError(errorSecondary)).toBe(true);
  });

  it('returns true for 403 with exhausted primary rate-limit headers', () => {
    expect.assertions(2);
    const error = Object.assign(new Error('Forbidden'), {
      status: 403,
      response: {
        data: { message: 'Forbidden' },
        headers: { 'x-ratelimit-remaining': '0' },
      },
    });
    expect(isRateLimitError(error)).toBe(true);
    expect(isForbiddenError(error)).toBe(false);
  });

  it('returns false for 403 without rate limit message', () => {
    expect.assertions(2);
    const error = Object.assign(new Error('Forbidden'), {
      status: 403,
      response: { data: { message: 'Permission denied' } },
    });
    expect(isRateLimitError(error)).toBe(false);

    const errorNoResponse = Object.assign(new Error('Forbidden'), { status: 403 });
    expect(isRateLimitError(errorNoResponse)).toBe(false);
  });
});

describe('isNotFoundError', () => {
  it('returns false for non-404 errors', () => {
    expect.assertions(2);
    const error403 = Object.assign(new Error('Forbidden'), { status: 403 });
    expect(isNotFoundError(error403)).toBe(false);

    const error500 = Object.assign(new Error('Server Error'), { status: 500 });
    expect(isNotFoundError(error500)).toBe(false);
  });

  it('returns true for 404 errors', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Not Found'), { status: 404 });
    expect(isNotFoundError(error)).toBe(true);
  });
});

describe('isValidationError', () => {
  it('returns true for 422 errors', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Validation Error'), { status: 422 });
    expect(isValidationError(error)).toBe(true);
  });

  it('returns false for non-422 errors', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Bad Request'), { status: 400 });
    expect(isValidationError(error)).toBe(false);
  });
});

describe('isForbiddenError', () => {
  it('returns true for 403 without rate limit', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Forbidden'), {
      status: 403,
      response: { data: { message: 'Permission denied' } },
    });
    expect(isForbiddenError(error)).toBe(true);
  });

  it('returns false for 403 with rate limit message', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Rate limit'), {
      status: 403,
      response: { data: { message: 'Rate limit exceeded' } },
    });
    expect(isForbiddenError(error)).toBe(false);
  });

  it('returns false for non-403 errors', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Not Found'), { status: 404 });
    expect(isForbiddenError(error)).toBe(false);
  });
});

describe('isUnauthorizedError', () => {
  it('returns true for 401 errors', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Unauthorized'), { status: 401 });
    expect(isUnauthorizedError(error)).toBe(true);
  });

  it('returns false for non-401 errors', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Forbidden'), { status: 403 });
    expect(isUnauthorizedError(error)).toBe(false);
  });
});

describe('getErrorMessage', () => {
  it('extracts message from Octokit error response', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('API Error'), {
      status: 422,
      response: { data: { message: 'Validation failed: body is too long' } },
    });
    expect(getErrorMessage(error)).toBe('Validation failed: body is too long');
  });

  it('falls back to error message when no response data', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Network error'), { status: 500 });
    expect(getErrorMessage(error)).toBe('Network error');
  });

  it('returns error message for plain Error', () => {
    expect.assertions(1);
    expect(getErrorMessage(new Error('Test error'))).toBe('Test error');
  });

  it('returns "Unknown error" for non-Error values', () => {
    expect.assertions(1);
    expect(getErrorMessage('string error')).toBe('Unknown error');
  });
});

describe('getRateLimitRetryAfter', () => {
  it('returns null for non-rate-limit errors', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Not Found'), { status: 404 });
    expect(getRateLimitRetryAfter(error)).toBeNull();
  });

  it('extracts retry-after header from 429 response', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Rate limit'), {
      status: 429,
      response: { headers: { 'retry-after': '60' } },
    });
    expect(getRateLimitRetryAfter(error)).toBe(60);
  });

  it('calculates from x-ratelimit-reset header', () => {
    expect.assertions(1);
    const futureTime = Math.floor(Date.now() / 1000) + 120;
    const error = Object.assign(new Error('Rate limit'), {
      status: 403,
      response: {
        data: { message: 'rate limit' },
        headers: { 'x-ratelimit-reset': String(futureTime) },
      },
    });
    const result = getRateLimitRetryAfter(error);
    expect(result).toBeGreaterThan(100);
  });

  it('returns null when headers are missing', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Rate limit'), {
      status: 429,
      response: {},
    });
    expect(getRateLimitRetryAfter(error)).toBeNull();
  });
});

describe('isGraphQLResponseError', () => {
  it('returns false for non-Error values', () => {
    expect.assertions(2);
    expect(isGraphQLResponseError(null)).toBe(false);
    expect(isGraphQLResponseError({ errors: [] })).toBe(false);
  });

  it('returns false for Error without errors array', () => {
    expect.assertions(1);
    expect(isGraphQLResponseError(new Error('Some error'))).toBe(false);
  });

  it('returns true for Error with errors array', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('GraphQL Error'), {
      errors: [{ message: 'Not found' }],
    });
    expect(isGraphQLResponseError(error)).toBe(true);
  });
});

describe('extractGraphQLErrors', () => {
  it('returns null for non-GraphQL errors', () => {
    expect.assertions(1);
    expect(extractGraphQLErrors(new Error('Regular error'))).toBeNull();
  });

  it('returns errors array from GraphQL error', () => {
    expect.assertions(2);
    const errors = [{ message: 'Not found', type: 'NOT_FOUND' }];
    const error = Object.assign(new Error('GraphQL Error'), { errors });
    const result = extractGraphQLErrors(error);
    expect(result).not.toBeNull();
    expect(result).toEqual(errors);
  });
});

describe('isGraphQLNotFoundError', () => {
  it('returns true for NOT_FOUND type', () => {
    expect.assertions(1);
    const errors = [{ message: 'Resource error', type: 'NOT_FOUND' }];
    expect(isGraphQLNotFoundError(errors)).toBe(true);
  });

  it('returns true for "not found" message', () => {
    expect.assertions(1);
    const errors = [{ message: 'Could not resolve to a Node', type: 'SOME_TYPE' }];
    expect(isGraphQLNotFoundError(errors)).toBe(true);
  });

  it('returns false for other errors', () => {
    expect.assertions(1);
    const errors = [{ message: 'Permission denied', type: 'FORBIDDEN' }];
    expect(isGraphQLNotFoundError(errors)).toBe(false);
  });
});

describe('isGraphQLForbiddenError', () => {
  it('returns true for FORBIDDEN type', () => {
    expect.assertions(1);
    const errors = [{ message: 'No access', type: 'FORBIDDEN' }];
    expect(isGraphQLForbiddenError(errors)).toBe(true);
  });

  it('returns true for INSUFFICIENT_SCOPES type', () => {
    expect.assertions(1);
    const errors = [{ message: 'Need more scope', type: 'INSUFFICIENT_SCOPES' }];
    expect(isGraphQLForbiddenError(errors)).toBe(true);
  });

  it('returns true for permission message', () => {
    expect.assertions(1);
    const errors = [{ message: 'You do not have permission to do this' }];
    expect(isGraphQLForbiddenError(errors)).toBe(true);
  });

  it('returns false for other errors', () => {
    expect.assertions(1);
    const errors = [{ message: 'Not found', type: 'NOT_FOUND' }];
    expect(isGraphQLForbiddenError(errors)).toBe(false);
  });
});

describe('isGraphQLRateLimitError', () => {
  it('returns true for RATE_LIMITED type', () => {
    expect.assertions(1);
    const errors = [{ message: 'Too many requests', type: 'RATE_LIMITED' }];
    expect(isGraphQLRateLimitError(errors)).toBe(true);
  });

  it('returns true for rate limit message', () => {
    expect.assertions(1);
    const errors = [{ message: 'API rate limit exceeded' }];
    expect(isGraphQLRateLimitError(errors)).toBe(true);
  });

  it('returns false for other errors', () => {
    expect.assertions(1);
    const errors = [{ message: 'Not found', type: 'NOT_FOUND' }];
    expect(isGraphQLRateLimitError(errors)).toBe(false);
  });
});

describe('getGraphQLErrorMessage', () => {
  it('returns first error message', () => {
    expect.assertions(1);
    const errors = [{ message: 'First error' }, { message: 'Second error' }];
    expect(getGraphQLErrorMessage(errors)).toBe('First error');
  });

  it('returns default message for empty array', () => {
    expect.assertions(1);
    expect(getGraphQLErrorMessage([])).toBe('GraphQL error');
  });
});

describe('parseValidationErrorReason', () => {
  it('returns "unknown" for non-validation errors', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Not Found'), { status: 404 });
    expect(parseValidationErrorReason(error)).toBe('unknown');
  });

  it('detects stale_diff from commit_id message', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Validation Error'), {
      status: 422,
      response: { data: { message: 'commit_id is not valid' } },
    });
    expect(parseValidationErrorReason(error)).toBe('stale_diff');
  });

  it('detects invalid_position from line/diff message', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Validation Error'), {
      status: 422,
      response: { data: { message: 'line not part of the diff' } },
    });
    expect(parseValidationErrorReason(error)).toBe('invalid_position');
  });

  it('detects pr_closed from closed message', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Validation Error'), {
      status: 422,
      response: { data: { message: 'Pull request is closed' } },
    });
    expect(parseValidationErrorReason(error)).toBe('pr_closed');
  });

  it('detects self_review from author message', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Validation Error'), {
      status: 422,
      response: { data: { message: 'author cannot be reviewer' } },
    });
    expect(parseValidationErrorReason(error)).toBe('self_review');
  });

  it('detects user_not_found', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Validation Error'), {
      status: 422,
      response: { data: { message: 'user not found' } },
    });
    expect(parseValidationErrorReason(error)).toBe('user_not_found');
  });

  it('detects team_not_found', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Validation Error'), {
      status: 422,
      response: { data: { message: 'team not found' } },
    });
    expect(parseValidationErrorReason(error)).toBe('team_not_found');
  });

  it('detects no_access from permission message', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Validation Error'), {
      status: 422,
      response: { data: { message: 'user lacks access to repository' } },
    });
    expect(parseValidationErrorReason(error)).toBe('no_access');
  });

  it('detects already_exists', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Validation Error'), {
      status: 422,
      response: { data: { message: 'Resource already exists' } },
    });
    expect(parseValidationErrorReason(error)).toBe('already_exists');
  });

  it('returns unknown for unrecognized message', () => {
    expect.assertions(1);
    const error = Object.assign(new Error('Validation Error'), {
      status: 422,
      response: { data: { message: 'Some unrecognized error' } },
    });
    expect(parseValidationErrorReason(error)).toBe('unknown');
  });
});
