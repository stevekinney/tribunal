import { describe, expect, it } from 'vitest';
import { isWorkflowCancellationReason, workflowCancellationReasons } from './context.js';

describe('workflow cancellation reasons', () => {
  it('accepts only the public workflow cancellation reasons', () => {
    for (const reason of workflowCancellationReasons) {
      expect(isWorkflowCancellationReason(reason)).toBe(true);
    }

    expect(isWorkflowCancellationReason('disabled')).toBe(false);
    expect(isWorkflowCancellationReason(null)).toBe(false);
  });
});
