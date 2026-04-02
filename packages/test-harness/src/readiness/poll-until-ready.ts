import { systemClock, systemSleeper } from "@mistle/time";

export async function pollUntilReady<T>(input: {
  timeoutMs: number;
  intervalMs: number;
  poll: () => Promise<T>;
  shouldRetry: (error: unknown) => boolean;
  createTimeoutError: (lastError: unknown) => Error;
}): Promise<T> {
  const deadline = systemClock.nowMs() + input.timeoutMs;
  let lastError: unknown;

  while (systemClock.nowMs() < deadline) {
    try {
      return await input.poll();
    } catch (error) {
      lastError = error;

      if (!input.shouldRetry(error)) {
        throw error;
      }

      if (systemClock.nowMs() + input.intervalMs >= deadline) {
        throw input.createTimeoutError(error);
      }

      await systemSleeper.sleep(input.intervalMs);
    }
  }

  throw input.createTimeoutError(lastError);
}
