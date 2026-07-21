import { describe, expect, it } from 'vitest';
import {
  BudgetExceededError,
  CancellationError,
  ConflictError,
  NonRetryableError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  RetryableError,
  ServiceUnavailableError,
  TimeoutError,
  ValidationError,
} from './error-taxonomy.js';

describe('NonRetryableError', () => {
  it('defaults the type to NonRetryableError', () => {
    expect.assertions(3);
    const error = new NonRetryableError('boom');
    expect(error.message).toBe('boom');
    expect(error.type).toBe('NonRetryableError');
    expect(error.name).toBe('NonRetryableError');
  });

  it('accepts an explicit type override', () => {
    expect.assertions(1);
    const error = new NonRetryableError('boom', 'CustomType');
    expect(error.type).toBe('CustomType');
  });
});

describe('RetryableError', () => {
  it('defaults the type to RetryableError', () => {
    expect.assertions(3);
    const error = new RetryableError('transient');
    expect(error.message).toBe('transient');
    expect(error.type).toBe('RetryableError');
    expect(error.name).toBe('RetryableError');
  });
});

describe('ValidationError', () => {
  it('is a NonRetryableError with type ValidationError', () => {
    expect.assertions(3);
    const error = new ValidationError('bad input');
    expect(error).toBeInstanceOf(NonRetryableError);
    expect(error.type).toBe('ValidationError');
    expect(error.name).toBe('ValidationError');
  });
});

describe('NotFoundError', () => {
  it('formats the message from entity and identifier', () => {
    expect.assertions(3);
    const error = new NotFoundError('Repository', '42');
    expect(error.message).toBe('Repository not found: 42');
    expect(error.type).toBe('NotFoundError');
    expect(error).toBeInstanceOf(NonRetryableError);
  });
});

describe('PermissionError', () => {
  it('is a NonRetryableError with type PermissionError', () => {
    expect.assertions(2);
    const error = new PermissionError('nope');
    expect(error.type).toBe('PermissionError');
    expect(error.name).toBe('PermissionError');
  });
});

describe('ConflictError', () => {
  it('is a NonRetryableError with type ConflictError', () => {
    expect.assertions(2);
    const error = new ConflictError('already exists');
    expect(error.type).toBe('ConflictError');
    expect(error.name).toBe('ConflictError');
  });
});

describe('CancellationError', () => {
  it('formats the message with a reason when provided', () => {
    expect.assertions(3);
    const error = new CancellationError('analyzePullRequest', 'client disconnected');
    expect(error.message).toBe('analyzePullRequest cancelled: client disconnected');
    expect(error.type).toBe('CancellationError');
    expect(error).toBeInstanceOf(NonRetryableError);
  });

  it('formats the message without a reason', () => {
    expect.assertions(1);
    const error = new CancellationError('analyzePullRequest');
    expect(error.message).toBe('analyzePullRequest cancelled');
  });
});

describe('RateLimitError', () => {
  it('is a RetryableError and carries an optional retryAfterSeconds', () => {
    expect.assertions(4);
    const error = new RateLimitError('rate limited', 30);
    expect(error).toBeInstanceOf(RetryableError);
    expect(error.type).toBe('RateLimitError');
    expect(error.name).toBe('RateLimitError');
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('allows retryAfterSeconds to be omitted', () => {
    expect.assertions(1);
    const error = new RateLimitError('rate limited');
    expect(error.retryAfterSeconds).toBeUndefined();
  });
});

describe('ServiceUnavailableError', () => {
  it('defaults the message from the service name', () => {
    expect.assertions(2);
    const error = new ServiceUnavailableError('GitHub');
    expect(error.message).toBe('GitHub is temporarily unavailable');
    expect(error.type).toBe('ServiceUnavailableError');
  });

  it('accepts an explicit message override', () => {
    expect.assertions(1);
    const error = new ServiceUnavailableError('GitHub', 'custom message');
    expect(error.message).toBe('custom message');
  });
});

describe('TimeoutError', () => {
  it('formats the message from the operation name', () => {
    expect.assertions(3);
    const error = new TimeoutError('fetchPullRequest');
    expect(error.message).toBe('fetchPullRequest timed out');
    expect(error.type).toBe('TimeoutError');
    expect(error).toBeInstanceOf(RetryableError);
  });
});

describe('BudgetExceededError', () => {
  it('formats the message from budget type, current, and limit', () => {
    expect.assertions(5);
    const error = new BudgetExceededError('tokens', 1000, 1200);
    expect(error.message).toBe('tokens budget exceeded: 1200/1000');
    expect(error.type).toBe('BudgetExceededError');
    expect(error.budgetType).toBe('tokens');
    expect(error.limit).toBe(1000);
    expect(error.current).toBe(1200);
  });

  it('is a NonRetryableError', () => {
    expect.assertions(1);
    const error = new BudgetExceededError('wall_clock', 60, 61);
    expect(error).toBeInstanceOf(NonRetryableError);
  });
});
