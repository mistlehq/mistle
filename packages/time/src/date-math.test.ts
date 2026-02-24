import { describe, expect, it } from "vitest";

import { addMilliseconds } from "./date-math.js";
import { dateFromEpochMs } from "./epoch.js";

describe("@mistle/time date-math", () => {
  it("adds milliseconds to a Date", () => {
    const initial = dateFromEpochMs(100);
    expect(addMilliseconds(initial, 25).toISOString()).toBe("1970-01-01T00:00:00.125Z");
  });
});
