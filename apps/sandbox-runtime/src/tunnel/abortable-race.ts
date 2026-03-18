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
