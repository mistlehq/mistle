import { describe, expect, it } from "vitest";

import { parseOrganizationRoleValue, parseTimestampToIsoString } from "./members-parsing.js";

describe("members parsing helpers", () => {
  it("normalizes direct organization roles", () => {
    expect(parseOrganizationRoleValue("owner")).toBe("owner");
    expect(parseOrganizationRoleValue("admin")).toBe("admin");
    expect(parseOrganizationRoleValue("member")).toBe("member");
  });

  it("normalizes comma-separated roles with privilege ordering", () => {
    expect(parseOrganizationRoleValue("member,admin")).toBe("admin");
    expect(parseOrganizationRoleValue("member,owner")).toBe("owner");
    expect(parseOrganizationRoleValue("owner,member")).toBe("owner");
  });

  it("returns null for invalid roles", () => {
    expect(parseOrganizationRoleValue("viewer")).toBeNull();
    expect(parseOrganizationRoleValue("owner,viewer")).toBeNull();
    expect(parseOrganizationRoleValue(123)).toBeNull();
  });

  it("parses timestamp variants into iso strings", () => {
    expect(parseTimestampToIsoString("2026-02-25T12:00:00.000Z")).toBe("2026-02-25T12:00:00.000Z");
    expect(parseTimestampToIsoString("2026-02-25 12:00:00.123456+0000")).toBe(
      "2026-02-25T12:00:00.123Z",
    );
    expect(parseTimestampToIsoString("2026-02-25 12:00:00.123456+00")).toBe(
      "2026-02-25T12:00:00.123Z",
    );
  });

  it("parses date objects and epoch strings", () => {
    expect(parseTimestampToIsoString(new Date("2026-02-25T12:00:00.000Z"))).toBe(
      "2026-02-25T12:00:00.000Z",
    );
    expect(parseTimestampToIsoString("1772020800000")).toBe("2026-02-25T12:00:00.000Z");
  });

  it("returns null for invalid timestamps", () => {
    expect(parseTimestampToIsoString("not-a-date")).toBeNull();
    expect(parseTimestampToIsoString({})).toBeNull();
  });
});
