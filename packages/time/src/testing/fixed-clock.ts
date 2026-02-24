import type { Clock } from "../clock.js";

/**
 * Creates a deterministic clock pinned to a single timestamp.
 * Useful when the code under test only needs a stable notion of "now".
 */
export function createFixedClock(fixedNowMs: number): Clock {
  return {
    nowMs: () => fixedNowMs,
    nowDate: () => new Date(fixedNowMs),
  };
}
