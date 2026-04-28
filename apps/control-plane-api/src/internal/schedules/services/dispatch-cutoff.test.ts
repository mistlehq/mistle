import { describe, expect, it } from "vitest";

import {
  createScheduleDispatchIdempotencyKey,
  resolveDispatchCutoffMinute,
} from "./dispatch-cutoff.js";

describe("schedule dispatch enqueue helpers", () => {
  it("truncates the dispatch cutoff to minute precision", () => {
    expect(
      resolveDispatchCutoffMinute({
        now: new Date("2026-04-28T10:15:42.987Z"),
        cutoffSkewSeconds: 0,
      }),
    ).toBe("2026-04-28T10:15Z");
  });

  it("applies cutoff skew before truncating the minute", () => {
    expect(
      resolveDispatchCutoffMinute({
        now: new Date("2026-04-28T10:15:02.000Z"),
        cutoffSkewSeconds: 5,
      }),
    ).toBe("2026-04-28T10:14Z");
  });

  it("uses the cutoff minute as the workflow idempotency key", () => {
    expect(createScheduleDispatchIdempotencyKey("2026-04-28T10:15Z")).toBe(
      "schedule-dispatch:2026-04-28T10:15Z",
    );
  });
});
