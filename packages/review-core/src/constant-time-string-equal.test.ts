import { describe, expect, it } from 'vitest';
import { constantTimeStringEqual } from './constant-time-string-equal';

describe('constantTimeStringEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeStringEqual('s3cr3t-value', 's3cr3t-value')).toBe(true);
  });

  it('returns false for unequal strings of the same length', () => {
    expect(constantTimeStringEqual('s3cr3t-value', 's3cr3t-valuX')).toBe(false);
  });

  it('returns false for length mismatches without throwing', () => {
    expect(constantTimeStringEqual('short', 'a-much-longer-secret')).toBe(false);
    expect(constantTimeStringEqual('a-much-longer-secret', 'short')).toBe(false);
    expect(constantTimeStringEqual('', 'x')).toBe(false);
    expect(constantTimeStringEqual('x', '')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(constantTimeStringEqual('', '')).toBe(true);
  });

  it('handles multi-byte UTF-8 inputs', () => {
    expect(constantTimeStringEqual('café-clé-🔑', 'café-clé-🔑')).toBe(true);
    expect(constantTimeStringEqual('café-clé-🔑', 'cafe-cle-🔑')).toBe(false);
  });
});
