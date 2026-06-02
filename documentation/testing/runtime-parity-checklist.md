# Runtime Parity Checklist

This checklist ensures that code running in multiple runtime environments
(browser, web worker, SSR) behaves identically. Runtime parity gaps caused
markdown worker regressions where browser assumptions did not hold in worker
contexts.

## Background

Markdown worker regressions revealed that DOMParser
behavior, quirks-mode handling, and polyfill availability differed between the
browser main thread and the web worker runtime. SSR adds a third environment
with its own constraints. This checklist prevents environment-assumption bugs.

## Runtime Environment Comparison

| Capability              | Browser (main thread)       | Web Worker                         | SSR (Node.js)                             |
| ----------------------- | --------------------------- | ---------------------------------- | ----------------------------------------- |
| `document`              | Available                   | Not available                      | Not available                             |
| `window`                | Available                   | Not available                      | Not available                             |
| `navigator`             | Available                   | Partial (no `clipboard`)           | Not available                             |
| `DOMParser`             | Native, full HTML support   | Limited, XML-only in some runtimes | Not available (use `linkedom` or similar) |
| `fetch`                 | Available                   | Available                          | Available (Node 18+)                      |
| `requestAnimationFrame` | Available                   | Not available                      | Not available                             |
| `localStorage`          | Available                   | Not available                      | Not available                             |
| `URL`                   | Available                   | Available                          | Available                                 |
| `TextEncoder/Decoder`   | Available                   | Available                          | Available                                 |
| `structuredClone`       | Available                   | Available                          | Available (Node 17+)                      |
| `crypto`                | Available (`window.crypto`) | Available (`self.crypto`)          | Available (`node:crypto`)                 |
| CSS / computed styles   | Available                   | Not available                      | Not available                             |

## Parity Verification Checklist

### Before merge, verify for each affected runtime

- [ ] The code does not access `document`, `window`, or `navigator` at module scope.
- [ ] DOM parsing uses a polyfill or abstraction that works in all target runtimes.
- [ ] String/text processing does not depend on browser-specific `DOMParser` quirks.
- [ ] Error handling does not depend on browser-specific error types or messages.
- [ ] Event listeners are not registered in environments that lack the target API.

### DOMParser-specific checks

The browser `DOMParser` operates in full HTML mode with automatic error
correction. The worker `DOMParser` (when available) may operate in XML mode
with strict parsing. Key differences:

| Behavior                  | Browser HTML mode         | Worker XML mode       |
| ------------------------- | ------------------------- | --------------------- |
| Self-closing `<br>`       | Valid, no error           | May require `<br/>`   |
| Missing closing tags      | Auto-corrected            | Parse error           |
| Named entities (`&nbsp;`) | Resolved                  | May not be recognized |
| Quirks mode               | Active for legacy HTML    | Not applicable        |
| `<template>` content      | Accessible via `.content` | May not support       |

- [ ] HTML strings are well-formed (closed tags, escaped entities).
- [ ] `DOMParser` usage is wrapped in a helper that normalizes cross-runtime behavior.
- [ ] Tests run the same HTML through both runtime paths and compare output.

### Polyfill and shim verification

- [ ] Required polyfills are loaded before the code that depends on them.
- [ ] Polyfill behavior matches native API behavior (not a subset).
- [ ] Polyfill presence is tested in the worker context (not just assumed).
- [ ] Shim imports do not pull in browser-only dependencies.

### SSR-specific checks

- [ ] Components using `$effect` guard browser-only code with `browser` from `$app/environment`.
- [ ] No direct DOM manipulation in `+page.server.ts` or `+layout.server.ts`.
- [ ] `fetch` in SSR load functions uses the SvelteKit-provided `fetch` (for cookie forwarding).
- [ ] Streamed promises handle SSR serialization boundaries correctly.

## Common Parity Failures

### 1. DOMParser quirks in markdown rendering

**Symptom:** Markdown renders correctly in the browser preview but produces
broken HTML in the worker-generated output.

**Root cause:** The browser `DOMParser` auto-corrects malformed HTML. The worker
runtime either lacks `DOMParser` or uses an XML-strict variant.

**Prevention:** Use a unified rendering pipeline (rehype/remark) that does not
depend on `DOMParser`. If DOM parsing is unavoidable, use a cross-runtime
library (such as `linkedom` or `htmlparser2`).

### 2. Missing `requestAnimationFrame` in workers

**Symptom:** Scroll or animation code throws `requestAnimationFrame is not defined`.

**Root cause:** Workers do not have `requestAnimationFrame`. Code that uses it
at module scope or in non-guarded paths will fail.

**Prevention:** Gate animation code behind `typeof requestAnimationFrame !== 'undefined'`
or use `$app/environment` `browser` check.

### 3. `navigator.clipboard` in workers

**Symptom:** Clipboard operations fail silently or throw in worker contexts.

**Root cause:** `navigator` exists in workers but `clipboard` is not available.

**Prevention:** Always check `navigator.clipboard` availability before use.
Provide a fallback (such as `execCommand('copy')` or a user prompt).

### 4. CSS-dependent layout calculations in SSR

**Symptom:** Layout calculations return zero or incorrect values during SSR.

**Root cause:** `getComputedStyle`, `getBoundingClientRect`, and similar APIs
are not available during SSR.

**Prevention:** Defer layout calculations to `$effect` blocks or `onMount`.
Never use computed styles in load functions or server-side logic.

## Testing Patterns

### Worker parity test

Create a test that runs the same input through both the browser and worker
rendering paths, then compares the output.

```typescript
import { describe, it, expect } from 'vitest';

describe('markdown rendering parity', () => {
  it('produces identical output in browser and worker contexts', () => {
    const input = '# Hello\n\nA paragraph with **bold** and [a link](https://example.com).';
    const browserOutput = renderInBrowser(input);
    const workerOutput = renderInWorker(input);
    expect(workerOutput).toBe(browserOutput);
  });

  it('handles malformed HTML consistently', () => {
    const input = '<p>Unclosed paragraph<p>Another';
    const browserOutput = renderInBrowser(input);
    const workerOutput = renderInWorker(input);
    expect(workerOutput).toBe(browserOutput);
  });
});
```

### Polyfill verification test

```typescript
describe('worker polyfills', () => {
  it('DOMParser is available and functional', () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString('<p>test</p>', 'text/html');
    expect(doc.querySelector('p')?.textContent).toBe('test');
  });
});
```

## Related Documents

- `documentation/testing/ui-regression-matrix.md` -- UI permutation matrix
- `documentation/TESTING.md` -- testing overview and environment selection
