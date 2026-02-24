import { describe, expect, it } from "vitest";

import { createManualScheduler } from "./manual-scheduler.js";
import { createMutableClock } from "./mutable-clock.js";

describe("@mistle/time testing manual-scheduler", () => {
  it("runs callbacks only when due", () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const calls: string[] = [];

    scheduler.schedule(() => calls.push("due"), 200);

    expect(scheduler.runDue()).toBe(0);
    expect(calls).toEqual([]);

    clock.advanceMs(200);
    expect(scheduler.runDue()).toBe(1);
    expect(calls).toEqual(["due"]);
  });

  it("supports cancellation", () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const calls: string[] = [];

    const handle = scheduler.schedule(() => calls.push("never"), 0);
    scheduler.cancel(handle);

    expect(scheduler.runDue()).toBe(0);
    expect(calls).toEqual([]);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("executes due callbacks in due-time order", () => {
    const clock = createMutableClock(1_000);
    const scheduler = createManualScheduler(clock);
    const calls: string[] = [];

    scheduler.schedule(() => calls.push("b"), 200);
    scheduler.schedule(() => calls.push("a"), 100);
    scheduler.schedule(() => calls.push("c"), 300);

    clock.advanceMs(500);
    expect(scheduler.runDue()).toBe(3);
    expect(calls).toEqual(["a", "b", "c"]);
    expect(scheduler.pendingCount()).toBe(0);
  });
});
