import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatMemberDisplayName,
  formatRoleLabel,
  formatRoleSelectValue,
} from "./members-formatters.js";

describe("members formatters", () => {
  it("formats role labels", () => {
    expect(formatRoleLabel("owner")).toBe("Owner");
    expect(formatRoleLabel("admin")).toBe("Admin");
    expect(formatRoleLabel("member")).toBe("Member");
  });

  it("formats role labels for closed select value", () => {
    expect(formatRoleSelectValue("owner")).toBe("Owner");
    expect(formatRoleSelectValue("admin")).toBe("Admin");
    expect(formatRoleSelectValue("member")).toBe("Member");
    expect(formatRoleSelectValue(null)).toBeUndefined();
  });

  it("formats member display names with email fallback", () => {
    expect(formatMemberDisplayName({ name: "Alice", email: "alice@example.com" })).toBe(
      "Alice (alice@example.com)",
    );
    expect(formatMemberDisplayName({ name: "  ", email: "blank@example.com" })).toBe(
      "blank@example.com",
    );
    expect(formatMemberDisplayName({ name: "same@example.com", email: "same@example.com" })).toBe(
      "same@example.com",
    );
  });

  it("formats date-only values", () => {
    expect(formatDate("2026-01-01T00:00:00.000Z")).not.toContain(":");
    expect(formatDate("not-a-date")).toBe("Unknown");
  });
});
