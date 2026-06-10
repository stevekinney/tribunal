/**
 * Error taxonomy for durable workflow integration.
 *
 * These error classes provide semantic meaning for retry behavior:
 * - NonRetryableError: Permanent failures that should not be retried
 * - RetryableError: Transient failures that may succeed on retry
 *
 * TODO(weft): Convert these classifications into ../weft activity failure
 * metadata once workflow execution is wired back in.
 *
 * Weft mapping: these error `name`s feed RetryPolicy.nonRetryableErrors
 * (matched by error name) on each activity's ActivityCallOptions — the direct
 * equivalent of Temporal's nonRetryableErrorTypes. No new infrastructure needed.
 *
 * TODO(weft#449): Weft 0.3.0 has no scheduleToCloseTimeout (a cross-attempt
 * wall-clock budget). Until it lands, bound total retry time with
 * ctx.race([ctx.run(activity, ...), ctx.sleep(totalBudget)]).
 * https://github.com/stevekinney/weft/issues/449
 */

/**
 * Base class for errors that should NOT be retried.
 *
 * Use this for permanent failures:
 * - Invalid input/validation errors
 * - Resource not found
 * - Permission denied
 * - Business logic violations
 */
export class NonRetryableError extends Error {
  constructor(
    message: string,
    public readonly type: string = 'NonRetryableError',
  ) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/**
 * Base class for errors that SHOULD be retried.
 *
 * Use this for transient failures:
 * - Network timeouts
 * - Rate limiting
 * - Temporary service unavailability
 * - Database connection issues
 */
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly type: string = 'RetryableError',
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

// --- Specialized Non-Retryable Errors ---

/**
 * Input validation failed.
 */
export class ValidationError extends NonRetryableError {
  constructor(message: string) {
    super(message, 'ValidationError');
    this.name = 'ValidationError';
  }
}

/**
 * Requested entity does not exist.
 */
export class NotFoundError extends NonRetryableError {
  constructor(entity: string, identifier: string) {
    super(`${entity} not found: ${identifier}`, 'NotFoundError');
    this.name = 'NotFoundError';
  }
}

/**
 * Operation not permitted.
 */
export class PermissionError extends NonRetryableError {
  constructor(message: string) {
    super(message, 'PermissionError');
    this.name = 'PermissionError';
  }
}

/**
 * Operation conflicts with current state.
 */
export class ConflictError extends NonRetryableError {
  constructor(message: string) {
    super(message, 'ConflictError');
    this.name = 'ConflictError';
  }
}

/**
 * Operation was cancelled before completion.
 *
 * Non-retryable because:
 * - The original requester is no longer waiting for the result
 * - Retrying would waste resources on work nobody wants
 * - Workflow engines have native cancellation handling for workflow-initiated cancellations
 *
 * This error is for client-initiated cancellations (CLIENT_CLOSED_REQUEST, HTTP disconnects)
 * not workflow-engine cancellations.
 */
export class CancellationError extends NonRetryableError {
  constructor(operation: string, reason?: string) {
    super(
      reason ? `${operation} cancelled: ${reason}` : `${operation} cancelled`,
      'CancellationError',
    );
    this.name = 'CancellationError';
  }
}

// --- Specialized Retryable Errors ---

/**
 * External API rate limit exceeded.
 */
export class RateLimitError extends RetryableError {
  constructor(
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message, 'RateLimitError');
    this.name = 'RateLimitError';
  }
}

/**
 * External service temporarily unavailable.
 */
export class ServiceUnavailableError extends RetryableError {
  constructor(service: string, message?: string) {
    super(message ?? `${service} is temporarily unavailable`, 'ServiceUnavailableError');
    this.name = 'ServiceUnavailableError';
  }
}

/**
 * Network or connection timeout.
 */
export class TimeoutError extends RetryableError {
  constructor(operation: string) {
    super(`${operation} timed out`, 'TimeoutError');
    this.name = 'TimeoutError';
  }
}

/**
 * Token, tool call, or time budget exceeded.
 * Non-retryable because the budget is a hard limit - retrying would just hit it again.
 */
export class BudgetExceededError extends NonRetryableError {
  constructor(
    public readonly budgetType: 'tokens' | 'tool_calls' | 'turns' | 'wall_clock',
    public readonly limit: number,
    public readonly current: number,
  ) {
    super(`${budgetType} budget exceeded: ${current}/${limit}`, 'BudgetExceededError');
    this.name = 'BudgetExceededError';
  }
}
