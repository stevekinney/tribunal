/**
 * SEC-004: "a timeout must abort the underlying operation rather than
 * merely reject a wrapper promise." The previous implementation raced
 * `operation()` against a timer with `Promise.race` — once the timer won,
 * the wrapper promise rejected, but `operation()` itself kept running with
 * nothing left to observe it: no caller awaiting its result, no signal
 * telling it to stop, and no way to know its eventual resolution (or
 * rejection, which becomes an unhandled rejection) was ever handled. For a
 * fetch, a database query, or any operation that accepts a signal, that
 * means the timeout only stopped *waiting* — it never stopped the work.
 *
 * This still races against a timer, so a caller is guaranteed a result (or
 * rejection) by the deadline even if `operation` ignores cancellation
 * entirely. What's new: `operation` now receives the `AbortSignal` this
 * function creates and aborts on timeout (or on the caller's own
 * `abortSignal` firing), so a caller that threads it into
 * `fetch`/a query/etc. gets genuine cancellation of the underlying work,
 * not just an abandoned promise racing in the background.
 */
export async function runWithStandardizedTimeout<T>(input: {
  operation: (signal: AbortSignal) => Promise<T>;
  timeoutMilliseconds?: number;
  abortSignal?: AbortSignal;
}): Promise<T> {
  const timeoutMilliseconds = input.timeoutMilliseconds ?? 30_000;
  const internalController = new AbortController();

  let timeoutIdentifier: ReturnType<typeof setTimeout> | undefined;
  // A single named handler both aborts the internal signal (so a
  // cooperative `operation` stops) and rejects the race promise (so an
  // uncooperative one doesn't leave the caller waiting for the timeout).
  // Keeping this as one named listener — rather than a second anonymous
  // `{ once: true }` listener that only self-removes if it ever fires —
  // means `finally` can always remove it, so a long-lived `abortSignal`
  // reused across many calls never accumulates listeners from calls whose
  // signal never fired.
  let rejectOnExternalAbort: ((reason: Error) => void) | undefined;
  const onExternalAbort = () => {
    const cancellationError = new Error('Operation cancelled by client.');
    internalController.abort(cancellationError);
    rejectOnExternalAbort?.(cancellationError);
  };

  try {
    return await Promise.race([
      input.operation(internalController.signal),
      new Promise<T>((_, reject) => {
        rejectOnExternalAbort = reject;
        timeoutIdentifier = setTimeout(() => {
          const timeoutError = new Error(`Operation timed out after ${timeoutMilliseconds}ms.`);
          internalController.abort(timeoutError);
          reject(timeoutError);
        }, timeoutMilliseconds);

        // Round 12 review (P2): an `addEventListener('abort', ...)` call
        // does not replay an abort that already happened before this
        // function ran -- a real path for an operation queued behind
        // another (e.g. a concurrency limiter) and handed a caller
        // signal that disconnected while it waited. Without this check,
        // such an operation ran to completion or all the way to the
        // timeout instead of cancelling promptly, exactly like the
        // pre-existing `operation` never received a live signal at all
        // (this same file's own opening comment). Checking `.aborted`
        // up front and reacting immediately closes that window; the
        // listener below still handles the ordinary case where the
        // abort happens after this function has already started.
        if (input.abortSignal?.aborted) {
          onExternalAbort();
        } else {
          input.abortSignal?.addEventListener('abort', onExternalAbort, { once: true });
        }
      }),
    ]);
  } finally {
    // Cleanup runs whether the operation won the race, the timeout won,
    // or the caller's own signal fired — the timer and the external
    // abort listener never outlive this call, and a cooperative
    // `operation` implementation is always told to stop.
    clearTimeout(timeoutIdentifier);
    input.abortSignal?.removeEventListener('abort', onExternalAbort);
    if (!internalController.signal.aborted) {
      internalController.abort(new Error('Operation settled.'));
    }
  }
}

export async function emitRequestProgress(input: {
  sendNotification?: (notification: {
    method: string;
    params: Record<string, unknown>;
  }) => Promise<void>;
  progressToken?: string | number;
  progress: number;
  total?: number;
  message?: string;
}): Promise<void> {
  if (!input.sendNotification || input.progressToken === undefined) {
    return;
  }

  await input.sendNotification({
    method: 'notifications/progress',
    params: {
      progressToken: input.progressToken,
      progress: input.progress,
      ...(input.total !== undefined ? { total: input.total } : {}),
      ...(input.message ? { message: input.message } : {}),
    },
  });
}
