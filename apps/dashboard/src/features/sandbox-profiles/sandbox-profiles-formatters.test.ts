import { describe, expect, it } from "vitest";

import {
  formatSandboxProfileStatus,
  formatSandboxProfileUpdatedAt,
  getSandboxProfileStatusBadgeUi,
  isSandboxProfileStatus,
} from "./sandbox-profiles-formatters.js";

describe("sandbox profiles formatters", () => {
  it("formats status labels", () => {
    expect(formatSandboxProfileStatus("active")).toBe("Active");
    expect(formatSandboxProfileStatus("inactive")).toBe("Inactive");
  });

  it("returns status badge presentation", () => {
    expect(getSandboxProfileStatusBadgeUi("active")).toEqual({
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
      variant: "secondary",
    });
    expect(getSandboxProfileStatusBadgeUi("inactive")).toEqual({
      className: undefined,
      variant: "outline",
    });
  });

  it("identifies valid sandbox profile status values", () => {
    expect(isSandboxProfileStatus("active")).toBe(true);
    expect(isSandboxProfileStatus("inactive")).toBe(true);
    expect(isSandboxProfileStatus("ACTIVE")).toBe(false);
  });

  it("formats valid updated-at timestamps", () => {
    expect(formatSandboxProfileUpdatedAt("2026-01-01T00:00:00.000Z")).not.toBe("Unknown");
  });

  it("returns Unknown for invalid updated-at timestamps", () => {
    expect(formatSandboxProfileUpdatedAt("not-a-date")).toBe("Unknown");
  });
});
