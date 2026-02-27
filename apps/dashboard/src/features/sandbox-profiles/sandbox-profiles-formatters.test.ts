import { describe, expect, it } from "vitest";

import {
  formatSandboxProfileStatus,
  formatSandboxProfileUpdatedAt,
} from "./sandbox-profiles-formatters.js";

describe("sandbox profiles formatters", () => {
  it("formats status labels", () => {
    expect(formatSandboxProfileStatus("active")).toBe("Active");
    expect(formatSandboxProfileStatus("inactive")).toBe("Inactive");
  });

  it("formats valid updated-at timestamps", () => {
    expect(formatSandboxProfileUpdatedAt("2026-01-01T00:00:00.000Z")).not.toBe("Unknown");
  });

  it("returns Unknown for invalid updated-at timestamps", () => {
    expect(formatSandboxProfileUpdatedAt("not-a-date")).toBe("Unknown");
  });
});
