import { describe, expect, it } from "vitest";

import { deriveInitials } from "./derive-initials.js";

describe("deriveInitials", () => {
  it("returns up to two uppercase initials", () => {
    expect(deriveInitials({ name: "Mistle Labs", fallback: "O" })).toBe("ML");
  });

  it("ignores extra whitespace", () => {
    expect(deriveInitials({ name: "  Mistle   Labs  ", fallback: "O" })).toBe("ML");
  });

  it("returns the fallback when the name is empty", () => {
    expect(deriveInitials({ name: "   ", fallback: "U" })).toBe("U");
  });
});
