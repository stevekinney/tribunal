import { describe, expect, it } from 'vitest';
import { getEffortFallbackNotice } from './operator-ui';

describe('review operator UI helpers', () => {
  it('surfaces xhigh fallback for non-eligible models', () => {
    expect(getEffortFallbackNotice('sonnet', 'xhigh')).toBe(
      'xhigh will be stored, but this model falls back to high effort at runtime.',
    );
    expect(getEffortFallbackNotice('opus', 'xhigh')).toBeNull();
  });

  it('normalizes concrete Claude model ids before checking xhigh fallback eligibility', () => {
    expect(getEffortFallbackNotice('claude-opus-4-20250514', 'xhigh')).toBeNull();
    expect(getEffortFallbackNotice('claude-fable-20260601', 'xhigh')).toBeNull();
    expect(getEffortFallbackNotice('claude-sonnet-4-20250514', 'xhigh')).toBe(
      'xhigh will be stored, but this model falls back to high effort at runtime.',
    );
  });
});
