export function ignorePromiseRejectionAfterAbort<T>(
  promise: Promise<T>,
  abortSignal: AbortSignal,
): Promise<T> {
  return promise.catch((error: unknown) => {
    if (abortSignal.aborted) {
      return new Promise<T>(() => undefined);
    }

    throw error;
  });
}

/**
 * Creates a disposable promise that rejects when the parent abort signal fires.
 *
 * This is used in long-lived async loops where we need to race an operation
 * against a session-level shutdown signal without creating a fresh
 * `AbortSignal.any(...)` composite on every iteration.
 *
 * Callers must invoke `dispose()` in a `finally` block to remove the listener
 * when the raced operation settles first.
 */
export function createAbortRace(abortSignal: AbortSignal): {
  promise: Promise<never>;
  dispose: () => void;
} {
  let disposed = false;
  let rejectAbort: ((reason?: unknown) => void) | undefined;

  const handleAbort = (): void => {
    cleanup();
    rejectAbort?.(abortSignal.reason ?? new Error("operation was aborted"));
  };

  const cleanup = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;
    abortSignal.removeEventListener("abort", handleAbort);
  };

  const promise = new Promise<never>((_, reject) => {
    rejectAbort = reject;

    if (abortSignal.aborted) {
      handleAbort();
      return;
    }

    abortSignal.addEventListener("abort", handleAbort, { once: true });
  });

  return {
    promise,
    dispose: cleanup,
  };
}
