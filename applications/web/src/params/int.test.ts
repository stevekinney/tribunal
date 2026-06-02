import { describe, it, expect } from 'vitest';
import { match } from './int';

describe('int matcher', () => {
  describe('valid integers', () => {
    it('matches single digit', () => {
      expect(match('0')).toBe(true);
      expect(match('1')).toBe(true);
      expect(match('9')).toBe(true);
    });

    it('matches multi-digit numbers', () => {
      expect(match('10')).toBe(true);
      expect(match('123')).toBe(true);
      expect(match('999999')).toBe(true);
    });

    it('matches numbers with leading zeros', () => {
      expect(match('01')).toBe(true);
      expect(match('007')).toBe(true);
      expect(match('000123')).toBe(true);
    });

    it('matches large numbers', () => {
      expect(match('2147483647')).toBe(true);
      expect(match('9999999999999')).toBe(true);
    });
  });

  describe('invalid integers', () => {
    it('rejects empty string', () => {
      expect(match('')).toBe(false);
    });

    it('rejects negative numbers', () => {
      expect(match('-1')).toBe(false);
      expect(match('-123')).toBe(false);
    });

    it('rejects decimal numbers', () => {
      expect(match('1.5')).toBe(false);
      expect(match('3.14159')).toBe(false);
      expect(match('.5')).toBe(false);
    });

    it('rejects numbers with letters', () => {
      expect(match('123abc')).toBe(false);
      expect(match('abc123')).toBe(false);
      expect(match('12a34')).toBe(false);
    });

    it('rejects alphabetic strings', () => {
      expect(match('abc')).toBe(false);
      expect(match('goal')).toBe(false);
    });

    it('rejects strings with special characters', () => {
      expect(match('123-456')).toBe(false);
      expect(match('123_456')).toBe(false);
      expect(match('123 456')).toBe(false);
    });

    it('rejects strings with whitespace', () => {
      expect(match(' 123')).toBe(false);
      expect(match('123 ')).toBe(false);
      expect(match(' 123 ')).toBe(false);
    });
  });
});
