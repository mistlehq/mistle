import { describe, expect, it } from "vitest";

import { normalizeDatabaseTimestampToIso } from "./read-sandbox-usage-summary.js";

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
