import { describe, it, expect } from 'vitest';
import { stringify, stringifyOrNull } from './stringify';

// A circular reference that causes JSON.stringify to throw
function makeCircular(): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  obj.self = obj;
  return obj;
}

// An object whose toJSON throws
const throwingToJSON = {
  toJSON() {
    throw new Error('toJSON exploded');
  },
};

describe('stringify', () => {
  it('returns strings as-is', () => {
    expect(stringify('hello')).toBe('hello');
  });

  it('preserves string formatting including newlines', () => {
    const s = 'line 1\nline 2';
    expect(stringify(s)).toBe(s);
  });

  it('returns empty string for null', () => {
    expect(stringify(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(stringify(undefined)).toBe('');
  });

  it('serializes objects with default indentation', () => {
    expect(stringify({ foo: 'bar' })).toBe('{\n  "foo": "bar"\n}');
  });

  it('serializes arrays', () => {
    expect(stringify([1, 2, 3])).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('respects custom indent', () => {
    expect(stringify({ a: 1 }, 4)).toBe('{\n    "a": 1\n}');
  });

  it('falls back to String(value) for circular references', () => {
    expect(stringify(makeCircular())).toBe('[object Object]');
  });

  it('falls back to String(value) for BigInt', () => {
    expect(stringify(BigInt(42))).toBe('42');
  });

  it('falls back to String(value) when toJSON throws', () => {
    expect(stringify(throwingToJSON)).toBe('[object Object]');
  });

  it('serializes numbers', () => {
    expect(stringify(42)).toBe('42');
  });

  it('serializes booleans', () => {
    expect(stringify(true)).toBe('true');
  });
});

describe('stringifyOrNull', () => {
  it('returns strings as-is', () => {
    expect(stringifyOrNull('hello')).toBe('hello');
  });

  it('returns null for null', () => {
    expect(stringifyOrNull(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(stringifyOrNull(undefined)).toBeNull();
  });

  it('serializes objects with default indentation', () => {
    expect(stringifyOrNull({ foo: 'bar' })).toBe('{\n  "foo": "bar"\n}');
  });

  it('returns null for circular references instead of fallback string', () => {
    expect(stringifyOrNull(makeCircular())).toBeNull();
  });

  it('returns null for BigInt', () => {
    expect(stringifyOrNull(BigInt(42))).toBeNull();
  });

  it('returns null when toJSON throws', () => {
    expect(stringifyOrNull(throwingToJSON)).toBeNull();
  });

  it('respects custom indent', () => {
    expect(stringifyOrNull({ a: 1 }, 4)).toBe('{\n    "a": 1\n}');
  });
});
