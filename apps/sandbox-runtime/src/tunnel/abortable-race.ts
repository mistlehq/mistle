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
