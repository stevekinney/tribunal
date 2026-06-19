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

/**
 * Validate that a value is a non-empty string, throwing a {@link ValidationError} otherwise.
 * Shared across the GitHub review write paths (check runs, diff context) so the validation
 * message and trim semantics stay consistent.
 */
export function validateNonEmptyString(value: string | undefined, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${label} must be a non-empty string.`);
  }
}

export function validatePositiveInteger(value: number | undefined, label: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${label} must be a positive integer.`);
  }
}

export function validateRepositoryTarget(owner: string, repository: string): void {
  validateNonEmptyString(owner, 'owner');
  validateNonEmptyString(repository, 'repository');
}

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
