import type { Sleeper } from "../sleeper.js";

/**
 * Sleeper implementation for tests that should not wait on real time.
 * `sleep` resolves immediately regardless of requested duration.
 */
export const immediateSleeper: Sleeper = {
  sleep: async () => {},
};
