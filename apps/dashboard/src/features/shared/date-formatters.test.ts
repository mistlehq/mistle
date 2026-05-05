import { describe, expect, it } from "vitest";

import {
  formatCompactRelativeOrDate,
  formatDate,
  formatDateTime,
  formatRelativeOrDate,
  formatTimeZoneOffset,
} from "./date-formatters.js";

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

  it("formats timestamps in the provided timezone", () => {
    expect(formatDateTime("2026-07-01T13:00:00.000Z", "America/New_York")).toBe(
      "Jul 1, 2026, 9:00 AM",
    );
  });

  it("formats timezone offsets for the provided timestamp", () => {
    expect(
      formatTimeZoneOffset({
        isoDateTime: "2026-07-01T13:00:00.000Z",
        timeZone: "America/New_York",
      }),
    ).toBe("GMT-4");
  });

  it("formats recent timestamps with compact relative labels", () => {
    expect(
      formatCompactRelativeOrDate("2026-03-19T11:50:00.000Z", {
        nowEpochMs: Date.parse("2026-03-19T12:00:00.000Z"),
      }),
    ).toBe("10m");
    expect(
      formatCompactRelativeOrDate("2026-03-19T09:00:00.000Z", {
        nowEpochMs: Date.parse("2026-03-19T12:00:00.000Z"),
      }),
    ).toBe("3h");
    expect(
      formatCompactRelativeOrDate("2026-03-17T12:00:00.000Z", {
        nowEpochMs: Date.parse("2026-03-19T12:00:00.000Z"),
      }),
    ).toBe("2d");
    expect(
      formatCompactRelativeOrDate("2025-03-19T12:00:00.000Z", {
        nowEpochMs: Date.parse("2026-03-19T12:00:00.000Z"),
      }),
    ).toBe("1y");
  });
});
