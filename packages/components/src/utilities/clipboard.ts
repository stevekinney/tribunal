/**
 * Clipboard operations with fallback support.
 *
 * Provides a unified API for clipboard operations that works across
 * different browser contexts (secure vs non-secure, with/without permissions).
 */

/**
 * Result of a clipboard operation.
 */
export type ClipboardResult = { success: true } | { success: false; error: string };

/**
 * Copies text to the clipboard using the modern Clipboard API with
 * fallback to the legacy execCommand approach.
 *
 * @param text - The text to copy to clipboard
 * @returns A promise that resolves to the operation result
 *
 * @example
 * ```typescript
 * const result = await copyToClipboard('Hello, world!');
 * if (result.success) {
 *   console.log('Copied successfully');
 * } else {
 *   console.error('Copy failed:', result.error);
 * }
 * ```
 */
export async function copyToClipboard(text: string): Promise<ClipboardResult> {
  // Try the modern Clipboard API first
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return { success: true };
    } catch {
      // Fall through to legacy method
    }
  }

  // Fallback to execCommand for older browsers or restricted contexts
  if (fallbackCopy(text)) {
    return { success: true };
  }

  return {
    success: false,
    error: 'Clipboard access denied. Please copy manually.',
  };
}

/**
 * Legacy clipboard copy using a temporary textarea and execCommand.
 * Works in contexts where the Clipboard API is not available.
 *
 * @param text - The text to copy
 * @returns Whether the copy succeeded
 */
function fallbackCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;

  // Position off-screen to avoid visual flash
  textarea.style.cssText = `
		position: fixed;
		left: -9999px;
		top: 0;
		opacity: 0;
		pointer-events: none;
	`;

  document.body.appendChild(textarea);

  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length); // iOS support

    // execCommand is deprecated but still works as a fallback
    const success = document.execCommand('copy');
    return success;
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * Checks if clipboard operations are likely to succeed in the current context.
 * Note: This is a heuristic and doesn't guarantee success.
 *
 * @returns Whether clipboard operations are likely available
 */
export function isClipboardAvailable(): boolean {
  // Check for modern Clipboard API
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return true;
  }

  // Check if execCommand is available as fallback
  if (typeof document.execCommand === 'function') {
    return true;
  }

  return false;
}
