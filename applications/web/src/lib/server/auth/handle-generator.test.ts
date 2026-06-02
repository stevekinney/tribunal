import { describe, it, expect } from 'vitest';
import { validateHandleFormat, suggestHandle } from './handle-generator';

describe('handle-generator', () => {
  describe('validateHandleFormat', () => {
    it('accepts valid handles', () => {
      expect(validateHandleFormat('abc')).toEqual({ valid: true });
      expect(validateHandleFormat('test-user')).toEqual({ valid: true });
      expect(validateHandleFormat('user123')).toEqual({ valid: true });
      expect(validateHandleFormat('a1b2c3')).toEqual({ valid: true });
      expect(validateHandleFormat('a'.repeat(39))).toEqual({ valid: true });
    });

    it('rejects handles that are too short', () => {
      const result = validateHandleFormat('ab');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least 3');
    });

    it('rejects handles that are too long', () => {
      const result = validateHandleFormat('a'.repeat(40));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at most 39');
    });

    it('rejects handles with uppercase letters', () => {
      const result = validateHandleFormat('TestUser');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('lowercase');
    });

    it('rejects handles with invalid characters', () => {
      const result = validateHandleFormat('test_user');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('letters, numbers, and hyphens');
    });

    it('rejects handles starting with a hyphen', () => {
      const result = validateHandleFormat('-testuser');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('start and end');
    });

    it('rejects handles ending with a hyphen', () => {
      const result = validateHandleFormat('testuser-');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('start and end');
    });

    it('rejects reserved handles', () => {
      const reserved = ['admin', 'api', 'www', 'login', 'settings', 'tribunal'];
      for (const handle of reserved) {
        const result = validateHandleFormat(handle);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('reserved');
      }
    });
  });

  describe('suggestHandle', () => {
    it('suggests a handle from display name', () => {
      expect(suggestHandle('John Doe', 'john@example.com')).toBe('john-doe');
      expect(suggestHandle('Alice', 'alice@example.com')).toBe('alice');
    });

    it('falls back to email local part when display name is too short', () => {
      expect(suggestHandle('AB', 'alongerusername@example.com')).toBe('alongerusername');
    });

    it('falls back to email local part when display name is null', () => {
      expect(suggestHandle(null, 'username@example.com')).toBe('username');
    });

    it('slugifies special characters', () => {
      expect(suggestHandle("John O'Brien", 'john@example.com')).toBe('john-o-brien');
      expect(suggestHandle('María García', 'maria@example.com')).toBe('mar-a-garc-a');
    });

    it('collapses multiple hyphens', () => {
      expect(suggestHandle('John   Doe', 'john@example.com')).toBe('john-doe');
    });

    it('removes leading and trailing hyphens', () => {
      expect(suggestHandle(' John Doe ', 'john@example.com')).toBe('john-doe');
    });

    it('truncates to max length', () => {
      const longName = 'A'.repeat(50);
      const result = suggestHandle(longName, 'test@example.com');
      expect(result.length).toBeLessThanOrEqual(39);
    });

    it('generates a padded handle for very short inputs', () => {
      const result = suggestHandle('ab', 'ab@example.com');
      expect(result.length).toBeGreaterThanOrEqual(3);
    });
  });
});
