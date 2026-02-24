import { describe, expect, it } from "vitest";

import {
  dateFromEpochMs,
  dateFromEpochSeconds,
  toEpochSeconds,
  toIsoFromEpochSeconds,
} from "./epoch.js";

describe("@mistle/time epoch", () => {
  it("converts Date values to epoch seconds", () => {
    const date = dateFromEpochSeconds(1_700_000_123);
    expect(toEpochSeconds(date)).toBe(1_700_000_123);
  });

  it("creates Date values from epoch units", () => {
    expect(dateFromEpochMs(123).toISOString()).toBe("1970-01-01T00:00:00.123Z");
    expect(dateFromEpochSeconds(123).toISOString()).toBe("1970-01-01T00:02:03.000Z");
  });

  it("formats epoch seconds as ISO timestamps", () => {
    expect(toIsoFromEpochSeconds(1)).toBe("1970-01-01T00:00:01.000Z");
  });
});
