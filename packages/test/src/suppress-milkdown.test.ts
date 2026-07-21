import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('suppress-milkdown (node environment, no window)', () => {
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    originalStderrWrite = process.stderr.write;
    vi.resetModules();
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
  });

  it('suppresses stderr writes that match a Milkdown cleanup error pattern', async () => {
    const writeSpy = vi.fn(() => true);
    process.stderr.write = writeSpy as unknown as typeof process.stderr.write;

    // The module captures whatever process.stderr.write currently is as its
    // "original" at import time, then installs a wrapper around it.
    await import('./suppress-milkdown');

    const wrapped = process.stderr.write;
    const suppressed = wrapped.call(process.stderr, 'Context "editorView" not found\n');

    expect(suppressed).toBe(true);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('passes through stderr writes that do not match a Milkdown cleanup pattern', async () => {
    const passthroughSpy = vi.fn(() => true);
    process.stderr.write = passthroughSpy as unknown as typeof process.stderr.write;

    await import('./suppress-milkdown');

    const wrapped = process.stderr.write;
    wrapped.call(process.stderr, 'a completely unrelated error\n');

    expect(passthroughSpy).toHaveBeenCalledWith('a completely unrelated error\n');
  });

  it('suppresses Buffer stderr chunks that decode to a Milkdown cleanup message', async () => {
    // Node's real process.stderr.write receives Buffer instances (a Uint8Array
    // subclass whose toString() UTF-8 decodes by default), not plain
    // Uint8Arrays -- Buffer#toString() is what the source relies on here.
    const passthroughSpy = vi.fn(() => true);
    process.stderr.write = passthroughSpy as unknown as typeof process.stderr.write;

    await import('./suppress-milkdown');

    const wrapped = process.stderr.write;
    const chunk = Buffer.from('MilkdownError: teardown raced\n', 'utf-8');
    const suppressed = wrapped.call(process.stderr, chunk);

    expect(suppressed).toBe(true);
    expect(passthroughSpy).not.toHaveBeenCalled();
  });
});

describe('suppress-milkdown (browser-like environment)', () => {
  let addEventListenerCalls: Map<string, (event: unknown) => void>;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    vi.resetModules();
    addEventListenerCalls = new Map();
    originalConsoleError = console.error;

    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        addEventListenerCalls.set(type, listener);
      },
    });
  });

  afterEach(() => {
    console.error = originalConsoleError;
    vi.unstubAllGlobals();
  });

  it('suppresses console.error calls that match a Milkdown cleanup pattern', async () => {
    const consoleSpy = vi.fn();
    console.error = consoleSpy;

    // The module captures whatever console.error currently is as its
    // "original" at import time, then installs a wrapper around it.
    await import('./suppress-milkdown');

    const wrapped = console.error;
    wrapped('Context "schemaCtx" not found');

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('passes through console.error calls that do not match a Milkdown cleanup pattern', async () => {
    const consoleSpy = vi.fn();
    console.error = consoleSpy;

    await import('./suppress-milkdown');

    const wrapped = console.error;
    wrapped('a totally different error');

    expect(consoleSpy).toHaveBeenCalledWith('a totally different error');
  });

  it('prevents default for window error events caused by a Milkdown cleanup Error', async () => {
    await import('./suppress-milkdown');

    const listener = addEventListenerCalls.get('error');
    expect(listener).toBeDefined();

    const preventDefault = vi.fn();
    listener?.({ error: new Error('Context "editorView" not found'), preventDefault });

    expect(preventDefault).toHaveBeenCalled();
  });

  it('does not prevent default for unrelated window error events', async () => {
    await import('./suppress-milkdown');

    const listener = addEventListenerCalls.get('error');
    const preventDefault = vi.fn();
    listener?.({ error: new Error('totally unrelated crash'), preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('prevents default for unhandledrejection events caused by a Milkdown cleanup reason', async () => {
    await import('./suppress-milkdown');

    const listener = addEventListenerCalls.get('unhandledrejection');
    const preventDefault = vi.fn();
    listener?.({ reason: 'MilkdownError: async teardown', preventDefault });

    expect(preventDefault).toHaveBeenCalled();
  });

  it('does not prevent default for unrelated unhandledrejection events', async () => {
    await import('./suppress-milkdown');

    const listener = addEventListenerCalls.get('unhandledrejection');
    const preventDefault = vi.fn();
    listener?.({ reason: 'some other rejection', preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
  });
});
