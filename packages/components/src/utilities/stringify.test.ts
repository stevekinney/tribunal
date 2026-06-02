/**
 * Tests for defensive JSON stringification utilities.
 * Create stringify utility for defensive JSON serialization.
 */

import { describe, expect, it } from 'vitest';
import { stringify, stringifyOrNull } from './stringify';

describe('stringify', () => {
  describe('normal objects', () => {
    it('stringifies simple objects with default indentation', () => {
      const result = stringify({ foo: 'bar' });
      expect(result).toBe('{\n  "foo": "bar"\n}');
    });

    it('stringifies arrays', () => {
      const result = stringify([1, 2, 3]);
      expect(result).toBe('[\n  1,\n  2,\n  3\n]');
    });

    it('stringifies nested objects', () => {
      const result = stringify({ a: { b: { c: 1 } } });
      expect(result).toContain('"a"');
      expect(result).toContain('"b"');
      expect(result).toContain('"c"');
    });

    it('respects custom indentation', () => {
      const result = stringify({ foo: 'bar' }, 4);
      expect(result).toBe('{\n    "foo": "bar"\n}');
    });

    it('handles zero indentation', () => {
      const result = stringify({ foo: 'bar' }, 0);
      expect(result).toBe('{"foo":"bar"}');
    });
  });

  describe('primitive values', () => {
    it('returns strings unchanged', () => {
      expect(stringify('hello world')).toBe('hello world');
      expect(stringify('multi\nline\nstring')).toBe('multi\nline\nstring');
      expect(stringify('')).toBe('');
    });

    it('returns empty string for null', () => {
      expect(stringify(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(stringify(undefined)).toBe('');
    });

    it('stringifies numbers', () => {
      expect(stringify(42)).toBe('42');
      expect(stringify(3.14)).toBe('3.14');
      expect(stringify(-1)).toBe('-1');
    });

    it('stringifies booleans', () => {
      expect(stringify(true)).toBe('true');
      expect(stringify(false)).toBe('false');
    });
  });

  describe('error handling', () => {
    it('handles circular references with fallback', () => {
      const circular: Record<string, unknown> = { foo: 'bar' };
      circular.self = circular;
      const result = stringify(circular);
      expect(result).toBe('[object Object]');
    });

    it('handles BigInt with fallback', () => {
      const result = stringify(BigInt(123));
      expect(result).toBe('123');
    });

    it('handles objects with throwing toJSON', () => {
      const problematic = {
        toJSON() {
          throw new Error('Cannot serialize');
        },
      };
      const result = stringify(problematic);
      expect(result).toBe('[object Object]');
    });
  });

  describe('special cases', () => {
    it('preserves file content formatting', () => {
      const fileContent = 'line 1\nline 2\n\tindented line\n';
      expect(stringify(fileContent)).toBe(fileContent);
    });

    it('handles empty objects', () => {
      expect(stringify({})).toBe('{}');
    });

    it('handles empty arrays', () => {
      expect(stringify([])).toBe('[]');
    });

    it('handles Date objects', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const result = stringify(date);
      expect(result).toBe('"2024-01-01T00:00:00.000Z"');
    });
  });
});

describe('stringifyOrNull', () => {
  describe('normal objects', () => {
    it('stringifies simple objects with default indentation', () => {
      const result = stringifyOrNull({ foo: 'bar' });
      expect(result).toBe('{\n  "foo": "bar"\n}');
    });

    it('stringifies arrays', () => {
      const result = stringifyOrNull([1, 2, 3]);
      expect(result).toBe('[\n  1,\n  2,\n  3\n]');
    });

    it('respects custom indentation', () => {
      const result = stringifyOrNull({ foo: 'bar' }, 4);
      expect(result).toBe('{\n    "foo": "bar"\n}');
    });
  });

  describe('primitive values', () => {
    it('returns strings unchanged', () => {
      expect(stringifyOrNull('hello world')).toBe('hello world');
      expect(stringifyOrNull('multi\nline\nstring')).toBe('multi\nline\nstring');
      expect(stringifyOrNull('')).toBe('');
    });

    it('returns null for null input', () => {
      expect(stringifyOrNull(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(stringifyOrNull(undefined)).toBeNull();
    });

    it('stringifies numbers', () => {
      expect(stringifyOrNull(42)).toBe('42');
    });

    it('stringifies booleans', () => {
      expect(stringifyOrNull(true)).toBe('true');
      expect(stringifyOrNull(false)).toBe('false');
    });
  });

  describe('error handling', () => {
    it('returns null for circular references', () => {
      const circular: Record<string, unknown> = { foo: 'bar' };
      circular.self = circular;
      const result = stringifyOrNull(circular);
      expect(result).toBeNull();
    });

    it('returns null for BigInt', () => {
      const result = stringifyOrNull(BigInt(123));
      expect(result).toBeNull();
    });

    it('returns null for objects with throwing toJSON', () => {
      const problematic = {
        toJSON() {
          throw new Error('Cannot serialize');
        },
      };
      const result = stringifyOrNull(problematic);
      expect(result).toBeNull();
    });
  });

  describe('distinguishing success from failure', () => {
    it('allows callers to detect serialization failure', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      // Failure is indicated by a null result
      expect(stringifyOrNull(circular)).toBeNull();
    });

    it('returns empty string for empty string input (not null)', () => {
      // Empty string is a valid value, not a failure
      const result = stringifyOrNull('');
      expect(result).toBe('');
      expect(result).not.toBeNull();
    });
  });
});
