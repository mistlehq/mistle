import { describe, expect, it } from "vitest";

import { formatUserDisplayName, resolveUserDisplayName } from "./user-display-name.js";

describe("user display name", () => {
  it("falls back to email when the name is missing", () => {
    expect(resolveUserDisplayName({ name: null, email: "blank@example.com" })).toBe(
      "blank@example.com",
    );
    expect(resolveUserDisplayName({ name: "  ", email: "blank@example.com" })).toBe(
      "blank@example.com",
    );
  });

  it("avoids repeating the email when name and email are the same", () => {
    expect(resolveUserDisplayName({ name: "same@example.com", email: "same@example.com" })).toBe(
      "same@example.com",
    );
    expect(formatUserDisplayName({ name: "same@example.com", email: "same@example.com" })).toBe(
      "same@example.com",
    );
  });

  it("formats a display name with the email when both are meaningful", () => {
    expect(formatUserDisplayName({ name: "Alice", email: "alice@example.com" })).toBe(
      "Alice (alice@example.com)",
    );
  });
});
