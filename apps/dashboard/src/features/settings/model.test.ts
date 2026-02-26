import { describe, expect, it } from "vitest";

import {
  isSettingsPath,
  resolveSettingsBackDestination,
  SETTINGS_DEFAULT_PATH,
  SETTINGS_NAV_GROUPS,
} from "./model.js";

describe("settings model", () => {
  it("exposes the default settings route", () => {
    expect(SETTINGS_DEFAULT_PATH).toBe("/settings/account/profile");
  });

  it("detects settings paths", () => {
    expect(isSettingsPath("/settings")).toBe(true);
    expect(isSettingsPath("/settings/account/profile")).toBe(true);
    expect(isSettingsPath("/sessions")).toBe(false);
  });

  it("resolves a non-settings path as the back destination", () => {
    expect(resolveSettingsBackDestination("/sessions")).toBe("/sessions");
  });

  it("falls back to root when there is no non-settings destination", () => {
    expect(resolveSettingsBackDestination(null)).toBe("/");
    expect(resolveSettingsBackDestination("/settings/organization/members")).toBe("/");
  });

  it("includes organization providers in the settings nav groups", () => {
    const organizationGroup = SETTINGS_NAV_GROUPS.find((group) => group.label === "Organization");
    expect(organizationGroup).toBeDefined();
    expect(organizationGroup?.items.map((item) => item.to)).toEqual([
      "/settings/organization/general",
      "/settings/organization/members",
      "/settings/organization/providers",
    ]);
    for (const item of organizationGroup?.items ?? []) {
      expect(typeof item.icon).toBe("function");
    }

    const accountGroup = SETTINGS_NAV_GROUPS.find((group) => group.label === "Account");
    expect(accountGroup).toBeDefined();
    expect(accountGroup?.items.map((item) => item.to)).toEqual(["/settings/account/profile"]);
    for (const item of accountGroup?.items ?? []) {
      expect(typeof item.icon).toBe("function");
    }
  });
});
