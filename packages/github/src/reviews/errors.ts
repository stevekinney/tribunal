import {
  ConflictError,
  PermissionError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
} from '../error-taxonomy.js';
import {
  getErrorMessage,
  getRateLimitRetryAfter,
  isForbiddenError,
  isNotFoundError,
  isRateLimitError,
  isUnauthorizedError,
  isValidationError,
  isOctokitRequestError,
} from '../errors.js';

export function classifyGitHubWriteError(error: unknown): Error {
  if (isRateLimitError(error)) {
    return new RateLimitError(
      `GitHub API rate limit exceeded: ${getErrorMessage(error)}`,
      getRateLimitRetryAfter(error) ?? undefined,
    );
  }

  if (isValidationError(error)) {
    return new ValidationError(`GitHub rejected the request: ${getErrorMessage(error)}`);
  }

  if (isForbiddenError(error) || isUnauthorizedError(error)) {
    return new PermissionError(`GitHub permission denied: ${getErrorMessage(error)}`);
  }

  if (isNotFoundError(error)) {
    return new ValidationError(`GitHub resource not found: ${getErrorMessage(error)}`);
  }

  if (isOctokitRequestError(error) && error.status === 409) {
    return new ConflictError(`GitHub resource conflict: ${getErrorMessage(error)}`);
  }

  if (isOctokitRequestError(error) && error.status >= 500) {
    return new ServiceUnavailableError('GitHub', getErrorMessage(error));
  }

  return error instanceof Error ? error : new Error(String(error));
}

export async function withGitHubWriteErrorClassification<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw classifyGitHubWriteError(error);
  }
}
