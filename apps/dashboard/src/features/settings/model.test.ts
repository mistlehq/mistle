import { describe, expect, it } from "vitest";

import {
  isSettingsPath,
  resolveSettingsNavGroups,
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

  it("exposes only account and organization settings destinations in the settings nav groups", () => {
    const organizationGroup = SETTINGS_NAV_GROUPS.find((group) => group.label === "Organization");
    expect(organizationGroup).toBeDefined();
    expect(organizationGroup?.items.map((item) => item.to)).toEqual([
      "/settings/organization/general",
      "/settings/organization/members",
    ]);
    for (const item of organizationGroup?.items ?? []) {
      expect(typeof item.icon).toBe("function");
    }

    const accountGroup = SETTINGS_NAV_GROUPS.find((group) => group.label === "Account");
    expect(accountGroup).toBeDefined();
    expect(accountGroup?.items.map((item) => item.to)).toEqual(["/settings/account/profile"]);
    expect(accountGroup?.items.map((item) => item.label)).toEqual(["My Profile"]);
    for (const item of accountGroup?.items ?? []) {
      expect(typeof item.icon).toBe("function");
    }

    expect(SETTINGS_NAV_GROUPS.find((group) => group.label === "Developer")).toBeUndefined();
  });

  it("shows sandbox storage settings only for owners and admins", () => {
    const ownerOrganizationGroup = resolveSettingsNavGroups({ organizationRole: "owner" }).find(
      (group) => group.label === "Organization",
    );
    const adminOrganizationGroup = resolveSettingsNavGroups({ organizationRole: "admin" }).find(
      (group) => group.label === "Organization",
    );
    const memberOrganizationGroup = resolveSettingsNavGroups({ organizationRole: "member" }).find(
      (group) => group.label === "Organization",
    );

    expect(ownerOrganizationGroup?.items.map((item) => item.to)).toContain(
      "/settings/organization/sandboxes",
    );
    expect(adminOrganizationGroup?.items.map((item) => item.to)).toContain(
      "/settings/organization/sandboxes",
    );
    expect(memberOrganizationGroup?.items.map((item) => item.to)).not.toContain(
      "/settings/organization/sandboxes",
    );
  });

  it("shows identity linking settings only for owners and admins", () => {
    const ownerOrganizationGroup = resolveSettingsNavGroups({ organizationRole: "owner" }).find(
      (group) => group.label === "Organization",
    );
    const adminOrganizationGroup = resolveSettingsNavGroups({ organizationRole: "admin" }).find(
      (group) => group.label === "Organization",
    );
    const memberOrganizationGroup = resolveSettingsNavGroups({ organizationRole: "member" }).find(
      (group) => group.label === "Organization",
    );

    expect(ownerOrganizationGroup?.items.map((item) => item.to)).toContain(
      "/settings/organization/identity-linking",
    );
    expect(adminOrganizationGroup?.items.map((item) => item.to)).toContain(
      "/settings/organization/identity-linking",
    );
    expect(memberOrganizationGroup?.items.map((item) => item.to)).not.toContain(
      "/settings/organization/identity-linking",
    );
  });

  it("shows billing settings only for owners and admins when Stripe billing is enabled", () => {
    const ownerOrganizationGroup = resolveSettingsNavGroups({
      organizationRole: "owner",
      stripeBillingEnabled: true,
    }).find((group) => group.label === "Organization");
    const adminOrganizationGroup = resolveSettingsNavGroups({
      organizationRole: "admin",
      stripeBillingEnabled: true,
    }).find((group) => group.label === "Organization");
    const memberOrganizationGroup = resolveSettingsNavGroups({
      organizationRole: "member",
      stripeBillingEnabled: true,
    }).find((group) => group.label === "Organization");
    const disabledOrganizationGroup = resolveSettingsNavGroups({
      organizationRole: "owner",
    }).find((group) => group.label === "Organization");

    expect(ownerOrganizationGroup?.items.map((item) => item.to)).toContain(
      "/settings/organization/billing",
    );
    expect(adminOrganizationGroup?.items.map((item) => item.to)).toContain(
      "/settings/organization/billing",
    );
    expect(memberOrganizationGroup?.items.map((item) => item.to)).not.toContain(
      "/settings/organization/billing",
    );
    expect(disabledOrganizationGroup?.items.map((item) => item.to)).not.toContain(
      "/settings/organization/billing",
    );
  });

  it("shows API key settings only for owners and admins", () => {
    const ownerDeveloperGroup = resolveSettingsNavGroups({ organizationRole: "owner" }).find(
      (group) => group.label === "Developer",
    );
    const adminDeveloperGroup = resolveSettingsNavGroups({ organizationRole: "admin" }).find(
      (group) => group.label === "Developer",
    );
    const memberDeveloperGroup = resolveSettingsNavGroups({ organizationRole: "member" }).find(
      (group) => group.label === "Developer",
    );

    expect(ownerDeveloperGroup?.items.map((item) => item.to)).toEqual([
      "/settings/organization/api-keys",
    ]);
    expect(adminDeveloperGroup?.items.map((item) => item.to)).toEqual([
      "/settings/organization/api-keys",
    ]);
    expect(memberDeveloperGroup).toBeUndefined();
  });
});
