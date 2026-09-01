import { describe, expect, it } from 'vitest';
import { resolveTribunalUserId } from './user-identity';

describe('resolveTribunalUserId', () => {
  it('accepts a positive integer subject', () => {
    expect.assertions(1);
    expect(resolveTribunalUserId({ userId: '42' })).toBe(42);
  });

  it.each([
    ['an empty subject', ''],
    ['a zero subject', '0'],
    ['a leading-zero subject', '007'],
    ['a negative subject', '-1'],
    ['a decimal subject', '1.0'],
    ['a hexadecimal subject', '0x10'],
    ['a padded subject', ' 7 '],
    ['a non-numeric subject', 'user-7'],
  ])('refuses %s rather than coercing it', (_label, subject) => {
    expect.assertions(1);
    expect(resolveTribunalUserId({ userId: subject })).toBeNull();
  });

  it('accepts the largest identifier the column can hold', () => {
    expect.assertions(1);
    expect(resolveTribunalUserId({ userId: '2147483647' })).toBe(2_147_483_647);
  });

  it('refuses a subject past the end of the int4 column', () => {
    expect.assertions(1);
    // A safe integer, and no user's identifier. Left unchecked it reaches a
    // Drizzle predicate and returns `integer out of range` from PostgreSQL
    // instead of a refusal from the boundary that should own the decision.
    expect(resolveTribunalUserId({ userId: '2147483648' })).toBeNull();
  });

  it('refuses a subject beyond safe integer range', () => {
    expect.assertions(1);
    expect(resolveTribunalUserId({ userId: '9007199254740993' })).toBeNull();
  });
});
