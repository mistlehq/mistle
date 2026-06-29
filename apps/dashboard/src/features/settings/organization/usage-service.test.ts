import { describe, expect, it } from "vitest";

import { resolveCurrentUsageMonth } from "./usage-service.js";

describe("resolveCurrentUsageMonth", () => {
  it("uses the UTC calendar month", () => {
    const date = new Date("2026-06-30T23:30:00.000Z");

    expect(resolveCurrentUsageMonth(date)).toBe("2026-06");
  });
});
