// Side-effect import: must be first to intercept stderr before Vitest captures it
import '@tribunal/test/suppress-milkdown';

import { afterEach, vi } from 'vitest';

// Rendering a route component directly (rather than through the root
// `+layout.svelte`) skips `layout.css`, the only place Cinder's design tokens
// and `@layer` order get imported. Without it, browser-mode computed-style
// assertions would see plain inherited typography regardless of whether
// Cinder's own component CSS landed — exactly the gap this repo's dropped-CSS
// incidents keep coming from. Guarded to the browser project only: the
// server project has no `window`/DOM to attach a stylesheet to.
if (typeof window !== 'undefined') {
  await import('@lostgradient/cinder/styles');
}

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
