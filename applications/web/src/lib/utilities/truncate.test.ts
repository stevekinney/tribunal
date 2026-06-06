import { describe, it, expect } from 'vitest';
import { truncate } from './truncate';

describe('truncate', () => {
  it('returns the original string when shorter than maxLength', () => {
    expect(truncate('Hi', 5)).toBe('Hi');
  });

  it('returns the original string when exactly at maxLength', () => {
    expect(truncate('Hello', 5)).toBe('Hello');
  });

  it('truncates and appends default "..." suffix', () => {
    expect(truncate('Hello World', 5)).toBe('Hello...');
  });

  it('trims trailing whitespace before appending suffix', () => {
    // slice(0, 6) → 'Hello ' — the trailing space must be trimmed
    expect(truncate('Hello World', 6)).toBe('Hello...');
  });

  it('uses a custom suffix', () => {
    expect(truncate('Hello World', 5, '…')).toBe('Hello…');
  });

  it('uses an empty suffix', () => {
    expect(truncate('Hello World', 5, '')).toBe('Hello');
  });

  it('handles an empty string', () => {
    expect(truncate('', 5)).toBe('');
  });

  it('handles maxLength of zero', () => {
    expect(truncate('Hello', 0)).toBe('...');
  });

  it('handles a string that is all whitespace within the slice window', () => {
    expect(truncate('     World', 5, '!')).toBe('!');
  });
});
