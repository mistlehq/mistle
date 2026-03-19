import { describe, expect, it } from "vitest";

import { formatDate, formatRelativeOrDate } from "./date-formatters.js";

describe("date formatters", () => {
  it("formats recent timestamps with relative labels", () => {
    expect(
      formatRelativeOrDate("2026-03-19T11:50:00.000Z", {
        nowEpochMs: Date.parse("2026-03-19T12:00:00.000Z"),
      }),
    ).toBe("10 min ago");
  });

  it("formats older timestamps as absolute dates without time", () => {
    const isoDateTime = "2026-03-10T12:00:00.000Z";

    expect(
      formatRelativeOrDate(isoDateTime, {
        nowEpochMs: Date.parse("2026-03-19T12:00:00.000Z"),
      }),
    ).toBe(formatDate(isoDateTime));
  });

  it("supports future relative timestamps within the cutoff", () => {
    expect(
      formatRelativeOrDate("2026-03-22T12:00:00.000Z", {
        nowEpochMs: Date.parse("2026-03-19T12:00:00.000Z"),
      }),
    ).toBe("in 3 days");
  });

  it("returns Unknown for invalid timestamps", () => {
    expect(formatRelativeOrDate("not-a-date")).toBe("Unknown");
  });
});
