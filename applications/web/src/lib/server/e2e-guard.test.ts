import { describe, expect, it } from 'vitest';
import { assertE2EModeNotInProduction, constantTimeStringEqual } from './e2e-guard';

describe('constantTimeStringEqual', () => {
  it('returns true for identical secrets', () => {
    expect(constantTimeStringEqual('s3cr3t-value', 's3cr3t-value')).toBe(true);
  });

  it('returns false when secrets differ', () => {
    expect(constantTimeStringEqual('s3cr3t-value', 's3cr3t-valuX')).toBe(false);
  });

  // Regression: the previous `providedSecret !== expectedSecret` accepted only
  // exact matches too, but short-circuited on the first differing byte. The
  // length guard here must reject mismatched lengths *before* timingSafeEqual,
  // which throws on unequal-length buffers — proving we never feed it bad input.
  it('returns false for length mismatches without throwing', () => {
    expect(constantTimeStringEqual('short', 'a-much-longer-secret')).toBe(false);
    expect(constantTimeStringEqual('a-much-longer-secret', 'short')).toBe(false);
    expect(constantTimeStringEqual('', 'x')).toBe(false);
  });

  it('treats the empty string against itself as equal', () => {
    expect(constantTimeStringEqual('', '')).toBe(true);
  });

  it('handles multi-byte UTF-8 secrets', () => {
    expect(constantTimeStringEqual('café-clé-🔑', 'café-clé-🔑')).toBe(true);
    expect(constantTimeStringEqual('café-clé-🔑', 'cafe-cle-🔑')).toBe(false);
  });
});

describe('assertE2EModeNotInProduction', () => {
  // Regression: before this guard existed, NODE_ENV=production + E2E_TEST_MODE=1
  // started silently with the /__e2e__/* auth-bypass endpoints live.
  it('throws when E2E_TEST_MODE=1 is set in production', () => {
    expect(() =>
      assertE2EModeNotInProduction({ NODE_ENV: 'production', E2E_TEST_MODE: '1' }),
    ).toThrow(/E2E_TEST_MODE=1 is set in a production environment/);
  });

  it('does not throw when E2E_TEST_MODE is enabled outside production', () => {
    expect(() =>
      assertE2EModeNotInProduction({ NODE_ENV: 'test', E2E_TEST_MODE: '1' }),
    ).not.toThrow();
    expect(() =>
      assertE2EModeNotInProduction({ NODE_ENV: 'development', E2E_TEST_MODE: '1' }),
    ).not.toThrow();
    expect(() => assertE2EModeNotInProduction({ E2E_TEST_MODE: '1' })).not.toThrow();
  });

  it('does not throw in production when E2E_TEST_MODE is unset or not exactly "1"', () => {
    expect(() => assertE2EModeNotInProduction({ NODE_ENV: 'production' })).not.toThrow();
    expect(() =>
      assertE2EModeNotInProduction({ NODE_ENV: 'production', E2E_TEST_MODE: '0' }),
    ).not.toThrow();
    expect(() =>
      assertE2EModeNotInProduction({ NODE_ENV: 'production', E2E_TEST_MODE: 'true' }),
    ).not.toThrow();
  });

  it('does not throw for an empty environment', () => {
    expect(() => assertE2EModeNotInProduction({})).not.toThrow();
  });
});
