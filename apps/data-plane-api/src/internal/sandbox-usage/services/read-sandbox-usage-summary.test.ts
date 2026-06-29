import { describe, expect, it } from "vitest";

import {
  isUsageMeasurementComplete,
  normalizeDatabaseTimestampToIso,
} from "./read-sandbox-usage-summary.js";

describe("normalizeDatabaseTimestampToIso", () => {
  it("normalizes Postgres timestamp strings to ISO UTC timestamps", () => {
    expect(normalizeDatabaseTimestampToIso("2026-05-20 01:02:03+00")).toBe(
      "2026-05-20T01:02:03.000Z",
    );
    expect(normalizeDatabaseTimestampToIso("2026-05-20 01:02:03.123456+00")).toBe(
      "2026-05-20T01:02:03.123Z",
    );
    expect(normalizeDatabaseTimestampToIso("2026-05-20 01:02:03")).toBe("2026-05-20T01:02:03.000Z");
  });
});

describe("isUsageMeasurementComplete", () => {
  it("does not mark a current partial period as complete", () => {
    expect(
      isUsageMeasurementComplete({
        measuredFrom: "2026-05-01T00:00:00.000Z",
        periodStart: "2026-06-01T00:00:00.000Z",
        periodEnd: "2026-07-01T00:00:00.000Z",
        requestedAt: "2026-06-29T12:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("marks a period complete only when measurement covers the start and request time reaches the end", () => {
    expect(
      isUsageMeasurementComplete({
        measuredFrom: "2026-05-01T00:00:00.000Z",
        periodStart: "2026-06-01T00:00:00.000Z",
        periodEnd: "2026-07-01T00:00:00.000Z",
        requestedAt: "2026-07-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("does not mark a period complete when measurement starts after the period start", () => {
    expect(
      isUsageMeasurementComplete({
        measuredFrom: "2026-06-15T00:00:00.000Z",
        periodStart: "2026-06-01T00:00:00.000Z",
        periodEnd: "2026-07-01T00:00:00.000Z",
        requestedAt: "2026-07-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });
});
