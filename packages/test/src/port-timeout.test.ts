import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * findFreePort's timeout and non-EADDRINUSE error branches require either
 * waiting out a real 5s socket timeout or forcing an unusual OS-level error
 * (e.g. EACCES on a privileged port), which is slow and not portable across
 * CI environments. `node:net` is a third-party (Node builtin) dependency of
 * port.ts, not the module under test, so mocking `createServer` here lets us
 * drive those branches deterministically with fake timers.
 */
class FakeServer extends EventEmitter {
  unref = vi.fn();
  close = vi.fn((callback?: () => void) => {
    callback?.();
  });
  listen = vi.fn();
  address = vi.fn(() => ({ port: 54321 }));
}

describe('findFreePort timeout and error handling', () => {
  let fakeServer: FakeServer;
  const createServerMock = vi.fn(() => fakeServer);

  beforeEach(() => {
    fakeServer = new FakeServer();
    vi.resetModules();
    vi.doMock('node:net', () => ({ createServer: createServerMock }));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('node:net');
    vi.resetModules();
  });

  it('rejects after 5s when the preferred port never becomes available', async () => {
    const { findFreePort } = await import('./port');

    const resultPromise = findFreePort(4173);
    // Attach the rejection assertion before advancing timers so the
    // rejection is handled synchronously with the timer callback, avoiding a
    // spurious unhandled-rejection warning from the fake-timer scheduler.
    const assertion = expect(resultPromise).rejects.toThrow(
      /Timed out after 5000ms trying to find a free port \(preferred: 4173\)/,
    );
    // Server never emits 'listening' or 'error' -- simulate a hang.
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;

    expect(fakeServer.close).toHaveBeenCalled();
  });

  it('rejects after a fresh 5s budget when the fallback bind on port 0 also hangs', async () => {
    const { findFreePort } = await import('./port');

    const resultPromise = findFreePort(4173);

    // Preferred port is in use -- triggers the fallback listen(0, ...) path.
    const addressInUseError = Object.assign(new Error('address in use'), {
      code: 'EADDRINUSE',
    });
    fakeServer.emit('error', addressInUseError);
    expect(fakeServer.listen).toHaveBeenCalledWith(0, '127.0.0.1');

    const assertion = expect(resultPromise).rejects.toThrow(
      /Timed out after 5000ms trying to find a free port \(preferred: 4173\)/,
    );
    // Fallback never emits 'listening' either -- its own 5s budget expires.
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it('rejects immediately on a non-EADDRINUSE server error', async () => {
    const { findFreePort } = await import('./port');

    const resultPromise = findFreePort(4173);
    const permissionError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    fakeServer.emit('error', permissionError);

    await expect(resultPromise).rejects.toBe(permissionError);
    expect(fakeServer.listen).toHaveBeenCalledTimes(1);
  });

  it('resolves with the bound port once the server starts listening', async () => {
    const { findFreePort } = await import('./port');

    const resultPromise = findFreePort(4173);
    fakeServer.emit('listening');

    await expect(resultPromise).resolves.toBe(54321);
  });
});
