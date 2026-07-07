import { describe, expect, it } from 'vitest';
import { computeCacheHitRate } from './usage';

describe('computeCacheHitRate', () => {
  it('computes the share of input tokens served from the prompt cache', () => {
    expect(
      computeCacheHitRate({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 900,
        cacheCreationTokens: 0,
      }),
    ).toBeCloseTo(0.9);
  });

  it('counts cache-creation tokens toward the denominator but not the numerator', () => {
    expect(
      computeCacheHitRate({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 100,
      }),
    ).toBe(0);
  });

  it('returns zero when there are no input tokens at all', () => {
    expect(
      computeCacheHitRate({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      }),
    ).toBe(0);
  });
});
