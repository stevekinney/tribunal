/**
 * Tests for useAnnouncer screen reader announcement utility.
 * Create screen reader announcement utility hook.
 *
 * Tests via a wrapper component since useAnnouncer uses $effect for cleanup.
 */

import { page } from 'vitest/browser';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from 'vitest-browser-svelte';
import TestHarness from './use-announcer.test.svelte';
import type { Announcer } from './use-announcer.svelte';

describe('useAnnouncer', () => {
  beforeEach(() => {
    // Use fake timers for deterministic time control
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    // Restore real timers after each test
    vi.useRealTimers();
  });

  function renderWithAnnouncer(
    options?: Parameters<typeof import('./use-announcer.svelte').useAnnouncer>[0],
  ) {
    return new Promise<Announcer>((resolve) => {
      render(TestHarness, {
        options,
        onCreated: (a: Announcer) => {
          resolve(a);
        },
      });
    });
  }

  describe('initial state', () => {
    it('starts with empty message', async () => {
      await renderWithAnnouncer();

      const messageEl = page.getByTestId('message');
      await expect.element(messageEl).toHaveTextContent('');
    });

    it('has live region for screen readers', async () => {
      await renderWithAnnouncer();

      const liveRegion = document.querySelector('[aria-live="polite"]');
      expect(liveRegion).not.toBeNull();
    });
  });

  describe('announce()', () => {
    it('sets message after announcement', async () => {
      const a = await renderWithAnnouncer();

      a.announce('Test message');

      // Advance timers to trigger setTimeout(0)
      await vi.advanceTimersByTimeAsync(50);

      const messageEl = page.getByTestId('message');
      await expect.element(messageEl).toHaveTextContent('Test message');
    });

    it('clears message after clearDelay', async () => {
      const a = await renderWithAnnouncer({ clearDelay: 100 });

      a.announce('Test message');

      // Advance timers for message to appear
      await vi.advanceTimersByTimeAsync(50);
      const messageEl = page.getByTestId('message');
      await expect.element(messageEl).toHaveTextContent('Test message');

      // Advance timers for clearDelay
      await vi.advanceTimersByTimeAsync(150);
      await expect.element(messageEl).toHaveTextContent('');
    });

    it('can re-announce the same message', async () => {
      const a = await renderWithAnnouncer({ clearDelay: 500 });

      a.announce('Same message');
      await vi.advanceTimersByTimeAsync(50);

      const messageEl = page.getByTestId('message');
      await expect.element(messageEl).toHaveTextContent('Same message');

      // Announce again - should still work (clears then sets)
      a.announce('Same message');

      // Brief moment where it's cleared
      await vi.advanceTimersByTimeAsync(10);

      // Then set again
      await vi.advanceTimersByTimeAsync(50);
      await expect.element(messageEl).toHaveTextContent('Same message');
    });
  });

  describe('debouncing', () => {
    it('debounces rapid announcements when debounceMs > 0', async () => {
      const a = await renderWithAnnouncer({ debounceMs: 100, clearDelay: 1000 });

      // Fire multiple announcements rapidly
      a.announce('First');
      a.announce('Second');
      a.announce('Third');

      // Before debounce fires, message should still be empty
      await vi.advanceTimersByTimeAsync(50);
      const messageEl = page.getByTestId('message');
      await expect.element(messageEl).toHaveTextContent('');

      // After debounce + setTimeout(0), should show last message
      await vi.advanceTimersByTimeAsync(100);
      await expect.element(messageEl).toHaveTextContent('Third');
    });

    it('does not debounce when debounceMs is 0', async () => {
      const a = await renderWithAnnouncer({ debounceMs: 0, clearDelay: 1000 });

      a.announce('First');
      await vi.advanceTimersByTimeAsync(50);

      const messageEl = page.getByTestId('message');
      await expect.element(messageEl).toHaveTextContent('First');

      a.announce('Second');
      await vi.advanceTimersByTimeAsync(50);
      await expect.element(messageEl).toHaveTextContent('Second');
    });
  });

  describe('clear()', () => {
    it('clears current message immediately', async () => {
      const a = await renderWithAnnouncer({ clearDelay: 5000 });

      a.announce('Test');
      await vi.advanceTimersByTimeAsync(50);

      const messageEl = page.getByTestId('message');
      await expect.element(messageEl).toHaveTextContent('Test');

      a.clear();
      await expect.element(messageEl).toHaveTextContent('');
    });

    it('cancels pending debounced announcement', async () => {
      const a = await renderWithAnnouncer({ debounceMs: 200, clearDelay: 1000 });

      a.announce('Will be cancelled');
      await vi.advanceTimersByTimeAsync(50);

      a.clear();

      // Advance timers past debounce time
      await vi.advanceTimersByTimeAsync(250);

      const messageEl = page.getByTestId('message');
      await expect.element(messageEl).toHaveTextContent('');
    });
  });

  describe('cleanup on unmount', () => {
    it('does not throw when component unmounts with pending announcement', async () => {
      const a = await renderWithAnnouncer({ debounceMs: 500 });

      a.announce('Pending');

      // Unmount before debounce fires
      cleanup();

      // Advance timers past debounce time - should not throw
      await vi.advanceTimersByTimeAsync(600);

      // If we get here without error, cleanup worked
      expect(true).toBe(true);
    });
  });
});
