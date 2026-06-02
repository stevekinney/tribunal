/**
 * Clipboard hook with automatic copy state management.
 *
 * Wraps clipboard operations with "copied" state and automatic timeout reset.
 * Uses the fallback-enabled copyToClipboard utility for broad browser support.
 *
 * @example
 * ```svelte
 * <script>
 *   import { onDestroy } from 'svelte';
 *   import { useClipboard } from '../utilities/use-clipboard.svelte.js';
 *
 *   const clipboard = useClipboard();
 *   onDestroy(() => clipboard.destroy());
 *
 *   async function handleCopy() {
 *     await clipboard.copy('Hello, world!');
 *   }
 * </script>
 *
 * <button onclick={handleCopy}>
 *   {clipboard.isCopied ? 'Copied!' : 'Copy'}
 * </button>
 * ```
 */

import { copyToClipboard, type ClipboardResult } from './clipboard';

export type CopyState = 'idle' | 'copied' | 'failed';

export interface UseClipboardReturn {
  /** Current state of the clipboard operation */
  readonly state: CopyState;
  /** Error message if copy failed, null otherwise */
  readonly error: string | null;
  /** Convenience getter for checking if copy succeeded */
  readonly isCopied: boolean;
  /** Copy text to clipboard and manage state */
  copy: (text: string) => Promise<ClipboardResult>;
  /** Clean up pending timeout (call on component destroy) */
  destroy: () => void;
}

/**
 * Create a clipboard hook with automatic state management.
 *
 * @param resetDelay - Time in ms before state resets to idle (default: 2000)
 * @returns Clipboard state and copy function
 */
export function useClipboard(resetDelay = 2000): UseClipboardReturn {
  let state = $state<CopyState>('idle');
  let error = $state<string | null>(null);
  let resetTimeout: ReturnType<typeof setTimeout> | null = null;

  function scheduleReset() {
    // Clear any existing timeout
    if (resetTimeout !== null) {
      clearTimeout(resetTimeout);
    }

    // Schedule reset to idle
    resetTimeout = setTimeout(() => {
      state = 'idle';
      error = null;
      resetTimeout = null;
    }, resetDelay);
  }

  async function copy(text: string): Promise<ClipboardResult> {
    const result = await copyToClipboard(text);
    state = result.success ? 'copied' : 'failed';
    error = result.success ? null : result.error;
    scheduleReset();
    return result;
  }

  function destroy() {
    if (resetTimeout !== null) {
      clearTimeout(resetTimeout);
      resetTimeout = null;
    }
  }

  return {
    get state() {
      return state;
    },
    get error() {
      return error;
    },
    get isCopied() {
      return state === 'copied';
    },
    copy,
    destroy,
  };
}
