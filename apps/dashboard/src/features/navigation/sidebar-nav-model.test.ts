import { describe, expect, it } from "vitest";

import { isSidebarNavItemActive } from "./sidebar-nav-model.js";

describe("isSidebarNavItemActive", () => {
  it("matches exact mode only on exact pathname", () => {
    expect(isSidebarNavItemActive("/", { to: "/", label: "Home", matchMode: "exact" })).toBe(true);
    expect(
      isSidebarNavItemActive("/settings", { to: "/", label: "Home", matchMode: "exact" }),
    ).toBe(false);
  });

  it("matches section mode on exact and descendant pathnames", () => {
    expect(isSidebarNavItemActive("/settings", { to: "/settings", label: "Settings" })).toBe(true);
    expect(
      isSidebarNavItemActive("/settings/organization/members", {
        to: "/settings",
        label: "Settings",
      }),
    ).toBe(true);
    expect(isSidebarNavItemActive("/sessions", { to: "/settings", label: "Settings" })).toBe(false);
  });
});
