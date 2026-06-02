/**
 * Suppress Milkdown cleanup noise in test environments.
 *
 * Milkdown's internal callbacks can fire after the editor is destroyed during
 * test teardown, producing context-lookup errors that are noisy but not
 * actionable without patching Milkdown itself.
 *
 * This module is a **side-effect import** — loading it installs the
 * suppression hooks immediately. It must be the first import in any setup
 * file so that stderr is intercepted before the Vitest reporter captures it.
 *
 * Usage:
 *   import '@tribunal/test/suppress-milkdown';
 */

const milkdownCleanupErrorPatterns = [
  /Context "editorView" not found/,
  /Context "schemaCtx" not found/,
  /MilkdownError/,
];

function isMilkdownCleanupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return milkdownCleanupErrorPatterns.some((pattern) => pattern.test(message));
}

// Intercept stderr before Vitest reporter captures it
if (typeof process !== 'undefined' && process.stderr?.write) {
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const wrappedWrite = (chunk: string | Uint8Array, ...args: unknown[]): boolean => {
    const message = typeof chunk === 'string' ? chunk : chunk?.toString();
    if (message && milkdownCleanupErrorPatterns.some((pattern) => pattern.test(message))) {
      return true; // Suppress
    }
    return (originalStderrWrite as (...a: unknown[]) => boolean).call(
      process.stderr,
      chunk,
      ...args,
    ) as boolean;
  };
  process.stderr.write = wrappedWrite as typeof process.stderr.write;
}

// Suppress Milkdown errors in browser environment
if (typeof window !== 'undefined') {
  const originalConsoleError = console.error;
  console.error = function (...args: unknown[]) {
    const message = args.map(String).join(' ');
    if (milkdownCleanupErrorPatterns.some((pattern) => pattern.test(message))) {
      return; // Suppress
    }
    originalConsoleError.apply(console, args);
  };

  window.addEventListener('error', (event) => {
    if (isMilkdownCleanupError(event.error)) {
      event.preventDefault();
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (isMilkdownCleanupError(event.reason)) {
      event.preventDefault();
    }
  });
}
