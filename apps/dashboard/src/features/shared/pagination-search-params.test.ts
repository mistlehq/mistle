import { describe, expect, it } from "vitest";

import { parsePaginationCursor } from "./pagination-search-params.js";

describe("pagination search params", () => {
  it("normalizes missing and blank cursor params to null", () => {
    expect(parsePaginationCursor(null)).toBeNull();
    expect(parsePaginationCursor("")).toBeNull();
    expect(parsePaginationCursor("   ")).toBeNull();
  });

  it("trims non-empty cursor params", () => {
    expect(parsePaginationCursor(" cursor_after ")).toBe("cursor_after");
  });
});
