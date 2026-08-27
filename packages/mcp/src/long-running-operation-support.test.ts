import { describe, expect, it } from 'vitest';
import { getEventListeners } from 'node:events';
import {
  emitRequestProgress,
  runWithStandardizedTimeout,
} from './long-running-operation-support.js';

describe('runWithStandardizedTimeout', () => {
  it('resolves with the operation result when it finishes before the timeout', async () => {
    const result = await runWithStandardizedTimeout({
      operation: async () => 'done',
      timeoutMilliseconds: 1000,
    });
    expect(result).toBe('done');
  });

  it('rejects once the timeout elapses even if the operation never settles', async () => {
    let thrown: unknown;
    try {
      await runWithStandardizedTimeout({
        operation: () => new Promise<never>(() => {}), // never resolves or rejects
        timeoutMilliseconds: 20,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof Error).toBe(true);
    expect((thrown as Error).message).toContain('timed out');
  });

  it('aborts the signal handed to a cooperative operation once the timeout fires, proving the underlying work is actually cancelled', async () => {
    let observedAbort = false;
    let signalAtSettle: AbortSignal | undefined;

    let thrown: unknown;
    try {
      await runWithStandardizedTimeout({
        operation: (signal) =>
          new Promise<never>((_, reject) => {
            signalAtSettle = signal;
            signal.addEventListener(
              'abort',
              () => {
                observedAbort = true;
                reject(signal.reason);
              },
              { once: true },
            );
          }),
        timeoutMilliseconds: 20,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).not.toBeNull();
    expect(observedAbort).toBe(true);
    expect(signalAtSettle?.aborted).toBe(true);
  });

  it('aborts the operation signal when the caller-provided abortSignal fires, not merely on timeout', async () => {
    const callerController = new AbortController();
    let observedReason: unknown;

    const promise = runWithStandardizedTimeout({
      operation: (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              observedReason = signal.reason;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
      timeoutMilliseconds: 5000,
      abortSignal: callerController.signal,
    });

    callerController.abort();

    let thrown: unknown;
    try {
      await promise;
    } catch (error) {
      thrown = error;
    }

    expect(thrown instanceof Error).toBe(true);
    expect((thrown as Error).message).toContain('cancelled');
    expect(observedReason instanceof Error).toBe(true);
  });

  it('marks the internal signal aborted after a successful operation settles, so nothing is left listening', async () => {
    let capturedSignal: AbortSignal | undefined;
    await runWithStandardizedTimeout({
      operation: async (signal) => {
        capturedSignal = signal;
        return 'ok';
      },
      timeoutMilliseconds: 1000,
    });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('rejects immediately and cancels a cooperative operation when the caller-provided abortSignal is already aborted before the call starts', async () => {
    // Round 12 review (P2): `addEventListener('abort', ...)` never fires
    // for a signal that was aborted BEFORE the listener was attached --
    // a real scenario for an operation queued behind another and handed
    // a signal that disconnected while it waited. Proves this resolves
    // promptly (well under the operation's own long timeout) rather than
    // running to completion or waiting out the timeout.
    const preAbortedController = new AbortController();
    preAbortedController.abort(new Error('client disconnected before this operation started'));

    let observedAbort = false;
    let signalAtStart: AbortSignal | undefined;

    const start = performance.now();
    let thrown: unknown;
    try {
      await runWithStandardizedTimeout({
        operation: (signal) =>
          new Promise<never>((_, reject) => {
            signalAtStart = signal;
            if (signal.aborted) {
              observedAbort = true;
              reject(signal.reason);
              return;
            }
            signal.addEventListener(
              'abort',
              () => {
                observedAbort = true;
                reject(signal.reason);
              },
              { once: true },
            );
          }),
        timeoutMilliseconds: 5000,
        abortSignal: preAbortedController.signal,
      });
    } catch (error) {
      thrown = error;
    }
    const elapsedMilliseconds = performance.now() - start;

    expect(thrown instanceof Error).toBe(true);
    expect((thrown as Error).message).toContain('cancelled');
    expect(observedAbort).toBe(true);
    expect(signalAtStart?.aborted).toBe(true);
    // Well under the 5000ms timeout -- proves this didn't wait it out.
    expect(elapsedMilliseconds).toBeLessThan(1000);
  });

  it('does not leak abort listeners on a long-lived, reused external abortSignal whose signal never fires', async () => {
    // Regression test for a leaked anonymous `{ once: true }` listener:
    // it only self-removes when the signal actually fires, so a signal
    // that stays unfired across many calls accumulated one listener per
    // call. Simulates a caller-owned signal (e.g. a request-scoped
    // controller) reused across several sequential operations.
    const sharedController = new AbortController();

    for (let index = 0; index < 5; index += 1) {
      await runWithStandardizedTimeout({
        operation: async () => `result-${index}`,
        timeoutMilliseconds: 1000,
        abortSignal: sharedController.signal,
      });
    }

    expect(getEventListeners(sharedController.signal, 'abort').length).toBe(0);
  });
});

describe('emitRequestProgress', () => {
  it('does nothing when no sendNotification is provided', async () => {
    // No assertion target other than "does not throw" -- there is
    // nothing to observe when the notifier itself is absent.
    await expect(
      emitRequestProgress({ progressToken: 'token-1', progress: 50 }),
    ).resolves.toBeUndefined();
  });

  it('does nothing when no progressToken is provided, even with a sendNotification', async () => {
    const calls: unknown[] = [];
    await emitRequestProgress({
      sendNotification: async (notification) => {
        calls.push(notification);
      },
      progress: 50,
    });
    expect(calls).toHaveLength(0);
  });

  it('sends a notifications/progress notification with progressToken and progress when both are present', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    await emitRequestProgress({
      sendNotification: async (notification) => {
        calls.push(notification);
      },
      progressToken: 'token-2',
      progress: 10,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('notifications/progress');
    expect(calls[0]?.params).toEqual({ progressToken: 'token-2', progress: 10 });
  });

  it('includes total in the notification params when provided', async () => {
    const calls: Array<{ params: Record<string, unknown> }> = [];
    await emitRequestProgress({
      sendNotification: async (notification) => {
        calls.push(notification as { params: Record<string, unknown> });
      },
      progressToken: 'token-3',
      progress: 25,
      total: 100,
    });
    expect(calls[0]?.params).toEqual({ progressToken: 'token-3', progress: 25, total: 100 });
  });

  it('omits total from the notification params when not provided', async () => {
    const calls: Array<{ params: Record<string, unknown> }> = [];
    await emitRequestProgress({
      sendNotification: async (notification) => {
        calls.push(notification as { params: Record<string, unknown> });
      },
      progressToken: 'token-4',
      progress: 25,
    });
    expect(calls[0]?.params).not.toHaveProperty('total');
  });

  it('includes message in the notification params when provided', async () => {
    const calls: Array<{ params: Record<string, unknown> }> = [];
    await emitRequestProgress({
      sendNotification: async (notification) => {
        calls.push(notification as { params: Record<string, unknown> });
      },
      progressToken: 'token-5',
      progress: 25,
      message: 'still working',
    });
    expect(calls[0]?.params).toEqual({
      progressToken: 'token-5',
      progress: 25,
      message: 'still working',
    });
  });

  it('omits message from the notification params when not provided or empty', async () => {
    const calls: Array<{ params: Record<string, unknown> }> = [];
    await emitRequestProgress({
      sendNotification: async (notification) => {
        calls.push(notification as { params: Record<string, unknown> });
      },
      progressToken: 'token-6',
      progress: 25,
      message: '',
    });
    expect(calls[0]?.params).not.toHaveProperty('message');
  });
});
