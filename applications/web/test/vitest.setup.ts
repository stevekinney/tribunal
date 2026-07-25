// Side-effect import: must be first to intercept stderr before Vitest captures it
import '@tribunal/test/suppress-milkdown';

import { afterEach, vi } from 'vitest';

let browserCleanup: (() => void) | null = null;

const getBrowserCleanup = async () => {
  if (browserCleanup) return browserCleanup;
  const { cleanup } = await import('vitest-browser-svelte');
  browserCleanup = cleanup;
  return browserCleanup;
};

// Let pending Milkdown callbacks flush between tests (browser runner).
afterEach(async () => {
  if (typeof window === 'undefined') return;
  vi.restoreAllMocks();
  vi.useRealTimers();
  const cleanup = await getBrowserCleanup();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 50));
});
