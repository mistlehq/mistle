import { describe, expect, it } from "vitest";

import { resolveSessionTitleLabel } from "./session-title-presentation.js";

describe("resolveSessionTitleLabel", () => {
  it("returns the title when present", () => {
    expect(resolveSessionTitleLabel("Investigate flaky title rendering")).toBe(
      "Investigate flaky title rendering",
    );
  });

  it("returns Untitled when the title is null", () => {
    expect(resolveSessionTitleLabel(null)).toBe("Untitled");
  });

  it("returns Untitled when the title is blank", () => {
    expect(resolveSessionTitleLabel("   ")).toBe("Untitled");
  });
});
