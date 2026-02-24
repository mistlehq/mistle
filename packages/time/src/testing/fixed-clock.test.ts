import { describe, expect, it } from "vitest";

import { createFixedClock } from "./fixed-clock.js";

describe("@mistle/time testing fixed-clock", () => {
  it("always returns the fixed time", () => {
    const clock = createFixedClock(1_700_000_000_000);

    expect(clock.nowMs()).toBe(1_700_000_000_000);
    expect(clock.nowDate().toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });

  it("returns a fresh Date instance each call", () => {
    const clock = createFixedClock(1_700_000_000_000);

    const first = clock.nowDate();
    const second = clock.nowDate();

    expect(first).not.toBe(second);
    expect(first.getTime()).toBe(second.getTime());
  });
});
