import { describe, expect, it } from "vitest";

import { resolveUserDisplayName } from "./user-display-name.js";

describe("resolveUserDisplayName", () => {
  it("falls back to email when the name is missing", () => {
    expect(resolveUserDisplayName({ name: null, email: "blank@example.com" })).toBe(
      "blank@example.com",
    );
    expect(resolveUserDisplayName({ name: "   ", email: "blank@example.com" })).toBe(
      "blank@example.com",
    );
  });

  it("returns the trimmed name when it is present", () => {
    expect(resolveUserDisplayName({ name: "  Alice  ", email: "alice@example.com" })).toBe("Alice");
  });

  it("does not repeat the email as a display name", () => {
    expect(resolveUserDisplayName({ name: "same@example.com", email: "same@example.com" })).toBe(
      "same@example.com",
    );
  });
});
