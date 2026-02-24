import { describe, expect, it } from "vitest";

import { createMutableClock } from "./mutable-clock.js";

describe("@mistle/time testing mutable-clock", () => {
  it("supports reading, setting, and advancing time", () => {
    const clock = createMutableClock(100);

    expect(clock.nowMs()).toBe(100);
    expect(clock.nowDate().toISOString()).toBe("1970-01-01T00:00:00.100Z");

    clock.advanceMs(50);
    expect(clock.nowMs()).toBe(150);

    clock.setNowMs(1_000);
    expect(clock.nowMs()).toBe(1_000);
    expect(clock.nowDate().toISOString()).toBe("1970-01-01T00:00:01.000Z");
  });
});
