/**
 * Tests for useClipboard hook.
 * Create shared clipboard hook with copy state management.
 *
 * Uses .svelte.test.ts naming to run in browser environment with Playwright.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from 'vitest-browser-svelte';
import { useClipboard } from '@tribunal/components/utilities/use-clipboard';

describe('useClipboard', () => {
  let originalClipboard: Clipboard | undefined;
  let originalExecCommand: typeof document.execCommand | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    originalClipboard = navigator.clipboard;
    originalExecCommand = document.execCommand;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    cleanup();

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

  function mockClipboard(success = true) {
    const mockWriteText = success
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error('Permission denied'));

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      writable: true,
      configurable: true,
    });

    // Also mock execCommand for fallback path
    document.execCommand = vi.fn().mockReturnValue(success);

    return mockWriteText;
  }

  describe('initial state', () => {
    it('starts with idle state', () => {
      mockClipboard();
      const clipboard = useClipboard();

      expect(clipboard.state).toBe('idle');
      expect(clipboard.error).toBeNull();
      expect(clipboard.isCopied).toBe(false);
    });
  });

  describe('copy operation', () => {
    it('transitions to copied state on success', async () => {
      const mockWriteText = mockClipboard(true);
      const clipboard = useClipboard();

      await clipboard.copy('test content');

      expect(mockWriteText).toHaveBeenCalledWith('test content');
      expect(clipboard.state).toBe('copied');
      expect(clipboard.isCopied).toBe(true);
      expect(clipboard.error).toBeNull();
    });

    it('transitions to failed state on error', async () => {
      mockClipboard(false);
      const clipboard = useClipboard();

      await clipboard.copy('test content');

      expect(clipboard.state).toBe('failed');
      expect(clipboard.isCopied).toBe(false);
      expect(clipboard.error).toBeTruthy();
    });

    it('returns ClipboardResult from copy', async () => {
      mockClipboard(true);
      const clipboard = useClipboard();

      const result = await clipboard.copy('test');

      expect(result).toEqual({ success: true });
    });

    it('returns error result when copy fails', async () => {
      mockClipboard(false);
      const clipboard = useClipboard();

      const result = await clipboard.copy('test');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeTruthy();
      }
    });
  });

  describe('auto-reset', () => {
    it('resets to idle after default delay (2000ms)', async () => {
      mockClipboard(true);
      const clipboard = useClipboard();

      await clipboard.copy('test');
      expect(clipboard.state).toBe('copied');

      // Advance time but not enough
      vi.advanceTimersByTime(1999);
      expect(clipboard.state).toBe('copied');

      // Advance past the threshold
      vi.advanceTimersByTime(2);
      expect(clipboard.state).toBe('idle');
      expect(clipboard.error).toBeNull();
    });

    it('uses custom reset delay', async () => {
      mockClipboard(true);
      const clipboard = useClipboard(500);

      await clipboard.copy('test');

      vi.advanceTimersByTime(499);
      expect(clipboard.state).toBe('copied');

      vi.advanceTimersByTime(2);
      expect(clipboard.state).toBe('idle');
    });

    it('resets failed state as well', async () => {
      mockClipboard(false);
      const clipboard = useClipboard(1000);

      await clipboard.copy('test');
      expect(clipboard.state).toBe('failed');

      vi.advanceTimersByTime(1001);

      expect(clipboard.state).toBe('idle');
      expect(clipboard.error).toBeNull();
    });

    it('clears timeout when copy is called again', async () => {
      mockClipboard(true);
      const clipboard = useClipboard(2000);

      // First copy
      await clipboard.copy('first');

      // Advance 1500ms
      vi.advanceTimersByTime(1500);
      expect(clipboard.state).toBe('copied');

      // Second copy resets the timer
      await clipboard.copy('second');

      // Advance another 1500ms (would have reset if timer wasn't cleared)
      vi.advanceTimersByTime(1500);
      expect(clipboard.state).toBe('copied');

      // Full 2000ms from second copy
      vi.advanceTimersByTime(500);
      expect(clipboard.state).toBe('idle');
    });
  });

  describe('state transitions', () => {
    it('can transition from copied to failed', async () => {
      const clipboard = useClipboard();

      // First: successful copy
      mockClipboard(true);
      await clipboard.copy('test');
      expect(clipboard.state).toBe('copied');

      // Second: failed copy
      mockClipboard(false);
      await clipboard.copy('test');
      expect(clipboard.state).toBe('failed');
    });

    it('can transition from failed to copied', async () => {
      const clipboard = useClipboard();

      // First: failed copy
      mockClipboard(false);
      await clipboard.copy('test');
      expect(clipboard.state).toBe('failed');

      // Second: successful copy
      mockClipboard(true);
      await clipboard.copy('test');
      expect(clipboard.state).toBe('copied');
    });
  });

  describe('isCopied convenience getter', () => {
    it('returns true only when state is copied', async () => {
      const clipboard = useClipboard();

      // idle
      expect(clipboard.isCopied).toBe(false);

      // copied
      mockClipboard(true);
      await clipboard.copy('test');
      expect(clipboard.isCopied).toBe(true);

      // failed
      mockClipboard(false);
      await clipboard.copy('test');
      expect(clipboard.isCopied).toBe(false);
    });
  });

  describe('multiple instances', () => {
    it('maintains independent state', async () => {
      mockClipboard(true);

      const clipboard1 = useClipboard();
      const clipboard2 = useClipboard();

      await clipboard1.copy('test');

      expect(clipboard1.state).toBe('copied');
      expect(clipboard2.state).toBe('idle');
    });
  });

  describe('destroy', () => {
    it('clears pending timeout on destroy', async () => {
      mockClipboard(true);
      const clipboard = useClipboard(2000);

      await clipboard.copy('test');
      expect(clipboard.state).toBe('copied');

      // Destroy before timeout fires
      clipboard.destroy();

      // Advance past the timeout - state should NOT reset because we destroyed
      vi.advanceTimersByTime(3000);
      expect(clipboard.state).toBe('copied');
    });

    it('is safe to call destroy multiple times', async () => {
      mockClipboard(true);
      const clipboard = useClipboard();

      await clipboard.copy('test');

      // Should not throw
      clipboard.destroy();
      clipboard.destroy();
      clipboard.destroy();

      expect(clipboard.state).toBe('copied');
    });

    it('is safe to call destroy when no timeout is pending', () => {
      mockClipboard(true);
      const clipboard = useClipboard();

      // Should not throw when called before any copy
      clipboard.destroy();

      expect(clipboard.state).toBe('idle');
    });
  });
});
