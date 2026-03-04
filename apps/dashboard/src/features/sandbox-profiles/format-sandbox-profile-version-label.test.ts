import { describe, expect, it } from "vitest";

import { formatSandboxProfileVersionLabel } from "./format-sandbox-profile-version-label.js";

describe("formatSandboxProfileVersionLabel", () => {
  it("formats a valid version", () => {
    expect(formatSandboxProfileVersionLabel(3)).toBe("Version 3");
  });

  it("throws for invalid versions", () => {
    expect(() => formatSandboxProfileVersionLabel(0)).toThrow(
      "Sandbox profile version must be a positive integer. Received '0'.",
    );
    expect(() => formatSandboxProfileVersionLabel(1.2)).toThrow(
      "Sandbox profile version must be a positive integer. Received '1.2'.",
    );
  });
});
