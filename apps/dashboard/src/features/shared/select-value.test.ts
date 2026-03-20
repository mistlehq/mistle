import { describe, expect, it } from "vitest";

import { resolveSelectableValue } from "./select-value.js";

describe("resolveSelectableValue", () => {
  it("returns null when there is no selected value", () => {
    expect(
      resolveSelectableValue({
        selectedValue: null,
        optionValues: ["a", "b"],
      }),
    ).toBeNull();
  });

  it("returns the selected value when it exists in the options", () => {
    expect(
      resolveSelectableValue({
        selectedValue: "b",
        optionValues: ["a", "b"],
      }),
    ).toBe("b");
  });

  it("returns null when the selected value is stale", () => {
    expect(
      resolveSelectableValue({
        selectedValue: "c",
        optionValues: ["a", "b"],
      }),
    ).toBeNull();
  });
});
