import { describe, expect, it } from "vitest";

import { clampMembersDirectoryOffset } from "./members-pagination.js";

describe("members pagination", () => {
  it("keeps already valid offsets", () => {
    expect(
      clampMembersDirectoryOffset({
        limit: 25,
        offset: 25,
        total: 60,
      }),
    ).toBe(25);
  });

  it("clamps stale offsets to the last valid page when the result set shrinks", () => {
    expect(
      clampMembersDirectoryOffset({
        limit: 25,
        offset: 50,
        total: 50,
      }),
    ).toBe(25);
  });

  it("resets to zero when no results remain", () => {
    expect(
      clampMembersDirectoryOffset({
        limit: 25,
        offset: 50,
        total: 0,
      }),
    ).toBe(0);
  });
});
