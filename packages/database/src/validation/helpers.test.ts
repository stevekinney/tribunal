import { describe, expect, it } from 'vitest';
import { idSchema, requiredString } from './helpers';

describe('requiredString', () => {
  it('accepts a non-empty string', () => {
    expect(requiredString.parse('hello')).toBe('hello');
  });

  it('trims surrounding whitespace', () => {
    expect(requiredString.parse('  hello  ')).toBe('hello');
  });

  it('rejects an empty string', () => {
    expect(() => requiredString.parse('')).toThrow('This field is required');
  });

  it('rejects a whitespace-only string', () => {
    expect(() => requiredString.parse('   ')).toThrow('This field is required');
  });

  it('rejects non-string input', () => {
    expect(() => requiredString.parse(42)).toThrow();
  });
});

describe('idSchema', () => {
  it('accepts a positive integer', () => {
    expect(idSchema.parse(1)).toBe(1);
  });

  it('coerces a numeric string to a number', () => {
    expect(idSchema.parse('42')).toBe(42);
  });

  it('rejects zero', () => {
    expect(() => idSchema.parse(0)).toThrow('Must be a positive integer');
  });

  it('rejects a negative number', () => {
    expect(() => idSchema.parse(-1)).toThrow('Must be a positive integer');
  });

  it('rejects a non-integer number', () => {
    expect(() => idSchema.parse(1.5)).toThrow();
  });

  it('rejects non-numeric input', () => {
    expect(() => idSchema.parse('not-a-number')).toThrow();
  });
});
