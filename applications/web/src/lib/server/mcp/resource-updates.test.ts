import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REVIEW_RUNS_RESOURCE_URI,
  clearResourceUpdatePublisher,
  notifyReviewRunsChanged,
  registerResourceUpdatePublisher,
} from './resource-updates';

afterEach(() => clearResourceUpdatePublisher());

describe('resource-update notifier (TRI-126)', () => {
  it('is a no-op when no publisher is registered (MCP disabled)', () => {
    expect(() => notifyReviewRunsChanged(5)).not.toThrow();
  });

  it('publishes the review-runs URI for the given user once a publisher is registered', () => {
    const publish = vi.fn();
    registerResourceUpdatePublisher(publish);

    notifyReviewRunsChanged(7);

    expect(publish).toHaveBeenCalledWith('7', REVIEW_RUNS_RESOURCE_URI);
  });

  it('contains and logs a publisher failure rather than propagating it (TRI-126)', () => {
    // The notifier fires inline from primary review mutations; a throwing
    // publisher must not surface as a failure of the mutation that triggered it.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerResourceUpdatePublisher(() => {
      throw new Error('publish boom');
    });

    expect(() => notifyReviewRunsChanged(7)).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith(
      '[mcp] resource-update notification failed',
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it('stops publishing after the publisher is cleared', () => {
    const publish = vi.fn();
    registerResourceUpdatePublisher(publish);
    clearResourceUpdatePublisher();

    notifyReviewRunsChanged(7);

    expect(publish).not.toHaveBeenCalled();
  });
});
