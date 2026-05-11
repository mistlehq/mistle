import { describe, expect, it } from "vitest";

import { parsePaginationCursor, readKeysetPaginationCursors } from "./pagination-search-params.js";

describe("pagination search params", () => {
  it("normalizes missing and blank cursor params to null", () => {
    expect(parsePaginationCursor(null)).toBeNull();
    expect(parsePaginationCursor("")).toBeNull();
    expect(parsePaginationCursor("   ")).toBeNull();
  });

  it("trims non-empty cursor params", () => {
    expect(parsePaginationCursor(" cursor_after ")).toBe("cursor_after");
  });

  it("reads before only when after is not present", () => {
    expect(readKeysetPaginationCursors(new URLSearchParams("after=cursor_after"))).toEqual({
      after: "cursor_after",
      before: null,
    });
    expect(readKeysetPaginationCursors(new URLSearchParams("before=cursor_before"))).toEqual({
      after: null,
      before: "cursor_before",
    });
    expect(
      readKeysetPaginationCursors(new URLSearchParams("after=cursor_after&before=cursor_before")),
    ).toEqual({
      after: "cursor_after",
      before: null,
    });
  });
});
