import { describe, it, expect } from 'vitest';
import { truncate } from './truncate';

describe('truncate', () => {
  describe('basic behavior', () => {
    it('returns original string when shorter than maxLength', () => {
      expect(truncate('Hi', 5)).toBe('Hi');
    });

    it('returns original string when exactly maxLength', () => {
      expect(truncate('Hello', 5)).toBe('Hello');
    });

    it('truncates and adds suffix when longer than maxLength', () => {
      expect(truncate('Hello World', 5)).toBe('Hello...');
    });

    it('trims trailing whitespace before adding suffix', () => {
      expect(truncate('Hello World', 6)).toBe('Hello...');
    });
  });

  describe('custom suffix', () => {
    it('uses custom suffix when provided', () => {
      expect(truncate('Hello World', 5, '…')).toBe('Hello…');
    });

    it('uses empty suffix when provided', () => {
      expect(truncate('Hello World', 5, '')).toBe('Hello');
    });

    it('uses multi-character custom suffix', () => {
      expect(truncate('Hello World', 5, ' [more]')).toBe('Hello [more]');
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(truncate('', 5)).toBe('');
    });

    it('handles maxLength of zero', () => {
      expect(truncate('Hello', 0)).toBe('...');
    });

    it('handles maxLength of one', () => {
      expect(truncate('Hello', 1)).toBe('H...');
    });

    it('handles single character string', () => {
      expect(truncate('H', 5)).toBe('H');
    });

    it('handles string with only whitespace', () => {
      expect(truncate('   ', 2)).toBe('...');
    });

    it('handles string that becomes empty after trim', () => {
      expect(truncate('  ', 1)).toBe('...');
    });
  });

  describe('unicode handling', () => {
    it('handles emoji at truncation boundary', () => {
      expect(truncate('Hello 😀 World', 6)).toBe('Hello...');
    });

    it('handles emoji within text', () => {
      expect(truncate('Hi 😀', 10)).toBe('Hi 😀');
    });

    it('handles multi-codepoint emoji correctly', () => {
      // Note: This slices by code units, not graphemes
      // '👨‍👩‍👧‍👦' is 11 code units (surrogate pairs + ZWJ)
      const familyEmoji = '👨‍👩‍👧‍👦';
      expect(truncate(`Test ${familyEmoji} end`, 5)).toBe('Test...');
    });

    it('handles accented characters', () => {
      expect(truncate('Café résumé', 4)).toBe('Café...');
    });

    it('handles Chinese characters', () => {
      expect(truncate('你好世界', 2)).toBe('你好...');
    });

    it('handles mixed scripts', () => {
      expect(truncate('Hello 世界', 6)).toBe('Hello...');
    });
  });

  describe('whitespace handling', () => {
    it('trims trailing space at cut point', () => {
      expect(truncate('Hello World Test', 6)).toBe('Hello...');
    });

    it('trims multiple trailing spaces', () => {
      expect(truncate('Hi    there', 4)).toBe('Hi...');
    });

    it('preserves leading whitespace', () => {
      expect(truncate('  Hello', 10)).toBe('  Hello');
    });

    it('handles tabs and newlines in truncated portion', () => {
      expect(truncate('Hello\t\nWorld', 7)).toBe('Hello...');
    });
  });
});
