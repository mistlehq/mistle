import type { Clock } from "../clock.js";

/**
 * Test clock that can be moved forward or set explicitly.
 * Use this when test scenarios depend on time progression.
 */
export type MutableClock = Clock & {
  setNowMs: (nextNowMs: number) => void;
  advanceMs: (durationMs: number) => void;
};

/**
 * Creates a controllable clock for deterministic tests.
 */
export function createMutableClock(initialNowMs = 0): MutableClock {
  let nowMs = initialNowMs;

  return {
    nowMs: () => nowMs,
    nowDate: () => new Date(nowMs),
    setNowMs: (nextNowMs) => {
      nowMs = nextNowMs;
    },
    advanceMs: (durationMs) => {
      nowMs += durationMs;
    },
  };
}
