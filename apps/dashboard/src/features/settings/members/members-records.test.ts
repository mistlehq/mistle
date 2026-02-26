import { describe, expect, it } from "vitest";

import { compactMap, readArray } from "./members-records.js";

describe("members records helpers", () => {
  it("returns null when reading arrays from non-array values", () => {
    expect(readArray(null)).toBeNull();
    expect(readArray("members")).toBeNull();
  });

  it("returns arrays unchanged when value is an array", () => {
    const value = ["owner", "member"];
    expect(readArray(value)).toEqual(value);
  });

  it("maps and compacts null entries", () => {
    const result = compactMap([1, 2, 3, 4], (value) => (value % 2 === 0 ? `m${value}` : null));
    expect(result).toEqual(["m2", "m4"]);
  });
});
