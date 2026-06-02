/**
 * Tests for clipboard utility functions.
 * Copy/export actions for chat messages and conversations.
 *
 * Uses .svelte.test.ts naming to run in browser environment with Playwright.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from 'vitest-browser-svelte';
import { copyToClipboard, isClipboardAvailable } from './clipboard';

describe('copyToClipboard', () => {
  let originalClipboard: Clipboard | undefined;
  let originalExecCommand: typeof document.execCommand | undefined;

  beforeEach(() => {
    // Store originals
    originalClipboard = navigator.clipboard;
    originalExecCommand = document.execCommand;
  });

  afterEach(() => {
    // Restore originals
    vi.restoreAllMocks();
    cleanup();

    // Restore clipboard
    if (originalClipboard !== undefined) {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        writable: true,
        configurable: true,
      });
    }

    // Restore execCommand
    if (originalExecCommand !== undefined) {
      document.execCommand = originalExecCommand;
    }
  });

  describe('modern Clipboard API', () => {
    it('uses navigator.clipboard.writeText when available', async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      });

      const result = await copyToClipboard('test content');

      expect(mockWriteText).toHaveBeenCalledWith('test content');
      expect(result).toEqual({ success: true });
    });

    it('returns success: true on successful copy', async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      });

      const result = await copyToClipboard('Hello, world!');

      expect(result.success).toBe(true);
    });

    it('handles empty strings', async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      });

      const result = await copyToClipboard('');

      expect(mockWriteText).toHaveBeenCalledWith('');
      expect(result.success).toBe(true);
    });

    it('handles multiline content', async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      });

      const content = 'Line 1\nLine 2\nLine 3';
      const result = await copyToClipboard(content);

      expect(mockWriteText).toHaveBeenCalledWith(content);
      expect(result.success).toBe(true);
    });

    it('handles unicode content', async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      });

      const content = 'Hello 你好 مرحبا 🎉';
      const result = await copyToClipboard(content);

      expect(mockWriteText).toHaveBeenCalledWith(content);
      expect(result.success).toBe(true);
    });
  });

  describe('fallback to execCommand', () => {
    beforeEach(() => {
      // Remove Clipboard API to force fallback
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      });
    });

    it('falls back to execCommand when Clipboard API is unavailable', async () => {
      const mockExecCommand = vi.fn().mockReturnValue(true);
      document.execCommand = mockExecCommand;

      const result = await copyToClipboard('test content');

      expect(mockExecCommand).toHaveBeenCalledWith('copy');
      expect(result.success).toBe(true);
    });

    it('falls back to execCommand when Clipboard API throws', async () => {
      const mockWriteText = vi.fn().mockRejectedValue(new Error('Permission denied'));
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      });

      const mockExecCommand = vi.fn().mockReturnValue(true);
      document.execCommand = mockExecCommand;

      const result = await copyToClipboard('test content');

      expect(mockWriteText).toHaveBeenCalled();
      expect(mockExecCommand).toHaveBeenCalledWith('copy');
      expect(result.success).toBe(true);
    });

    it('returns error when execCommand fails', async () => {
      const mockExecCommand = vi.fn().mockReturnValue(false);
      document.execCommand = mockExecCommand;

      const result = await copyToClipboard('test content');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Clipboard access denied');
      }
    });

    it('returns error when execCommand throws', async () => {
      const mockExecCommand = vi.fn().mockImplementation(() => {
        throw new Error('Not supported');
      });
      document.execCommand = mockExecCommand;

      const result = await copyToClipboard('test content');

      expect(result.success).toBe(false);
    });
  });

  describe('error handling', () => {
    it('returns error object when both methods fail', async () => {
      // Remove Clipboard API
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      // Make execCommand fail
      document.execCommand = vi.fn().mockReturnValue(false);

      const result = await copyToClipboard('test');

      expect(result).toEqual({
        success: false,
        error: 'Clipboard access denied. Please copy manually.',
      });
    });

    it('does not throw errors, always returns result object', async () => {
      const mockWriteText = vi.fn().mockRejectedValue(new Error('Boom!'));
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      });
      document.execCommand = vi.fn().mockReturnValue(false);

      // Should not throw
      const result = await copyToClipboard('test');
      expect(result.success).toBe(false);
    });
  });
});

describe('isClipboardAvailable', () => {
  let originalClipboard: Clipboard | undefined;
  let originalExecCommand: typeof document.execCommand | undefined;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    originalExecCommand = document.execCommand;
  });

  afterEach(() => {
    // Restore originals
    if (originalClipboard !== undefined) {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        writable: true,
        configurable: true,
      });
    }
    if (originalExecCommand !== undefined) {
      document.execCommand = originalExecCommand;
    }
  });

  it('returns true when Clipboard API is available', () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      writable: true,
      configurable: true,
    });

    expect(isClipboardAvailable()).toBe(true);
  });

  it('returns true when execCommand is available', () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    document.execCommand = vi.fn();

    expect(isClipboardAvailable()).toBe(true);
  });

  it('returns false when neither is available', () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    // @ts-expect-error - Testing edge case where execCommand is not a function
    document.execCommand = undefined;

    expect(isClipboardAvailable()).toBe(false);
  });
});
