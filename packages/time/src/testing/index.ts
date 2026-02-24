/**
 * Test-only time primitives.
 * Import from `@mistle/time/testing` to keep deterministic tests free of global timer mocking.
 */
export { createFixedClock } from "./fixed-clock.js";
export { immediateSleeper } from "./immediate-sleeper.js";
export { createManualScheduler, type ManualScheduler } from "./manual-scheduler.js";
export { createMutableClock, type MutableClock } from "./mutable-clock.js";
