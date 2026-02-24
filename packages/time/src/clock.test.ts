import { describe, expect, it } from "vitest";

import { systemClock } from "./clock.js";

describe("@mistle/time clock", () => {
  it("returns epoch milliseconds from systemClock.nowMs", () => {
    const before = Date.now();
    const nowMs = systemClock.nowMs();
    const after = Date.now();

    expect(nowMs).toBeGreaterThanOrEqual(before);
    expect(nowMs).toBeLessThanOrEqual(after);
  });

  it("returns Date instances from systemClock.nowDate", () => {
    const before = Date.now();
    const nowDate = systemClock.nowDate();
    const after = Date.now();

    expect(nowDate).toBeInstanceOf(Date);
    expect(nowDate.getTime()).toBeGreaterThanOrEqual(before);
    expect(nowDate.getTime()).toBeLessThanOrEqual(after);
  });
});
