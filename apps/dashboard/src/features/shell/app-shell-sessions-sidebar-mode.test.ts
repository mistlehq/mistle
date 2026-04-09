import { describe, expect, it } from "vitest";

import {
  isExistingSandboxSessionPath,
  resolveLocationHref,
  resolveSidebarModeDisableNavigationTarget,
  isNewSessionPath,
  isSessionsPath,
  resolveSessionsNavHref,
  resolveSidebarModeEnableNavigationTarget,
  SessionsRoutes,
} from "./app-shell-sessions-sidebar-mode.js";

describe("app shell sessions sidebar mode routing", () => {
  it("identifies sessions paths and the dedicated new-session route", () => {
    expect(isSessionsPath(SessionsRoutes.INDEX)).toBe(true);
    expect(isSessionsPath("/sessions/sbi_123")).toBe(true);
    expect(isSessionsPath("/automations")).toBe(false);
    expect(isNewSessionPath(SessionsRoutes.NEW)).toBe(true);
    expect(isNewSessionPath("/sessions/sbi_123")).toBe(false);
  });

  it("treats existing sandbox session detail routes as in-place sidebar toggles", () => {
    expect(isExistingSandboxSessionPath("/sessions/sbi_123")).toBe(true);
    expect(resolveSidebarModeEnableNavigationTarget("/sessions/sbi_123")).toBeNull();
  });

  it("routes the sessions index into the new-session page when enabling sidebar mode", () => {
    expect(isExistingSandboxSessionPath("/sessions")).toBe(false);
    expect(resolveSidebarModeEnableNavigationTarget("/sessions")).toBe(SessionsRoutes.NEW);
  });

  it("keeps the dedicated new-session route as the landing target when enabling sidebar mode", () => {
    expect(isExistingSandboxSessionPath("/sessions/new")).toBe(false);
    expect(resolveSidebarModeEnableNavigationTarget("/sessions/new")).toBe(SessionsRoutes.NEW);
  });

  it("routes non-session pages into the new-session page when enabling sidebar mode", () => {
    expect(isExistingSandboxSessionPath("/automations")).toBe(false);
    expect(resolveSidebarModeEnableNavigationTarget("/automations")).toBe(SessionsRoutes.NEW);
  });

  it("resolves the sessions nav href from the sidebar mode state", () => {
    expect(resolveSessionsNavHref(false)).toBe(SessionsRoutes.INDEX);
    expect(resolveSessionsNavHref(true)).toBe(SessionsRoutes.NEW);
  });

  it("builds a navigation href from pathname, search, and hash", () => {
    expect(
      resolveLocationHref({
        pathname: "/automations",
        search: "?tab=active",
        hash: "#details",
      }),
    ).toBe("/automations?tab=active#details");
  });

  it("returns to the previously recorded location when disabling sidebar mode", () => {
    expect(
      resolveSidebarModeDisableNavigationTarget({
        currentLocationHref: SessionsRoutes.NEW,
        currentPathname: SessionsRoutes.NEW,
        previousLocationHref: "/automations?tab=active#details",
      }),
    ).toBe("/automations?tab=active#details");
  });

  it("skips disable navigation when the current and previous locations match", () => {
    expect(
      resolveSidebarModeDisableNavigationTarget({
        currentLocationHref: "/sessions/sbi_123",
        currentPathname: "/sessions/sbi_123",
        previousLocationHref: "/sessions/sbi_123",
      }),
    ).toBeNull();
    expect(
      resolveSidebarModeDisableNavigationTarget({
        currentLocationHref: SessionsRoutes.NEW,
        currentPathname: SessionsRoutes.NEW,
        previousLocationHref: null,
      }),
    ).toBeNull();
  });

  it("skips disable navigation after the user has already left sessions", () => {
    expect(
      resolveSidebarModeDisableNavigationTarget({
        currentLocationHref: "/automations",
        currentPathname: "/automations",
        previousLocationHref: "/dashboard",
      }),
    ).toBeNull();
  });
});
