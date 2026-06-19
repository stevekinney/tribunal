import { describe, expect, it } from 'vitest';
import { getEffortFallbackNotice } from './operator-ui';

describe('review operator UI helpers', () => {
  it('surfaces xhigh fallback for non-eligible models', () => {
    expect(getEffortFallbackNotice('sonnet', 'xhigh')).toBe(
      'xhigh will be stored, but this model falls back to high effort at runtime.',
    );
    expect(getEffortFallbackNotice('opus', 'xhigh')).toBeNull();
  });
});
