import { describe, expect, it } from "vitest";

import {
  isExistingSandboxSessionPath,
  resolveLocationHref,
  resolveSidebarModeDisableNavigationTarget,
  isNewSessionPath,
  isSessionsPath,
  resolveSessionsSidebarModeEnabled,
  resolveSessionsNavHref,
  resolveSidebarModeEnableNavigationTarget,
  SessionsRoutes,
} from "./app-shell-sessions-sidebar-mode.js";

describe("app shell sessions sidebar mode routing", () => {
  it("identifies sessions paths and the dedicated new-session route", () => {
    expect(isSessionsPath(SessionsRoutes.INDEX)).toBe(true);
    expect(isSessionsPath("/sessions/sbi_123")).toBe(true);
    expect(isSessionsPath("/triggers")).toBe(false);
    expect(isNewSessionPath(SessionsRoutes.NEW)).toBe(true);
    expect(isNewSessionPath("/sessions/sbi_123")).toBe(false);
  });

  it("treats existing sandbox session detail routes as in-place sidebar toggles", () => {
    expect(isExistingSandboxSessionPath("/sessions/sbi_123")).toBe(true);
    expect(
      resolveSidebarModeEnableNavigationTarget({
        lastInteractedSessionHref: null,
        pathname: "/sessions/sbi_123",
      }),
    ).toBeNull();
  });

  it("routes the sessions index into the new-session page when enabling sidebar mode", () => {
    expect(isExistingSandboxSessionPath("/sessions")).toBe(false);
    expect(
      resolveSidebarModeEnableNavigationTarget({
        lastInteractedSessionHref: null,
        pathname: "/sessions",
      }),
    ).toBe(SessionsRoutes.NEW);
  });

  it("keeps the dedicated new-session route as the landing target when enabling sidebar mode", () => {
    expect(isExistingSandboxSessionPath("/sessions/new")).toBe(false);
    expect(
      resolveSidebarModeEnableNavigationTarget({
        lastInteractedSessionHref: null,
        pathname: "/sessions/new",
      }),
    ).toBe(SessionsRoutes.NEW);
  });

  it("routes non-session pages into the new-session page when enabling sidebar mode", () => {
    expect(isExistingSandboxSessionPath("/triggers")).toBe(false);
    expect(
      resolveSidebarModeEnableNavigationTarget({
        lastInteractedSessionHref: null,
        pathname: "/triggers",
      }),
    ).toBe(SessionsRoutes.NEW);
  });

  it("restores the last interacted session after toggling sidebar mode back on", () => {
    expect(
      resolveSidebarModeEnableNavigationTarget({
        lastInteractedSessionHref: "/sessions/sbi_123",
        pathname: "/triggers",
      }),
    ).toBe("/sessions/sbi_123");
  });

  it("does not restore the last interacted session when re-enabling from within sessions", () => {
    expect(
      resolveSidebarModeEnableNavigationTarget({
        lastInteractedSessionHref: "/sessions/sbi_123",
        pathname: "/sessions",
      }),
    ).toBe(SessionsRoutes.NEW);
  });

  it("resolves the sessions nav href from the sidebar mode state", () => {
    expect(resolveSessionsNavHref(false)).toBe(SessionsRoutes.INDEX);
    expect(resolveSessionsNavHref(true)).toBe(SessionsRoutes.NEW);
  });

  it("keeps the sessions sidebar mode scoped to sessions routes", () => {
    expect(
      resolveSessionsSidebarModeEnabled({
        pathname: SessionsRoutes.NEW,
        enabled: true,
      }),
    ).toBe(true);
    expect(
      resolveSessionsSidebarModeEnabled({
        pathname: "/",
        enabled: true,
      }),
    ).toBe(false);
    expect(
      resolveSessionsSidebarModeEnabled({
        pathname: SessionsRoutes.INDEX,
        enabled: false,
      }),
    ).toBe(false);
  });

  it("builds a navigation href from pathname, search, and hash", () => {
    expect(
      resolveLocationHref({
        pathname: "/triggers",
        search: "?tab=active",
        hash: "#details",
      }),
    ).toBe("/triggers?tab=active#details");
  });

  it("returns to the previously recorded location when disabling sidebar mode", () => {
    expect(
      resolveSidebarModeDisableNavigationTarget({
        currentLocationHref: SessionsRoutes.NEW,
        currentPathname: SessionsRoutes.NEW,
        previousLocationHref: "/triggers?tab=active#details",
      }),
    ).toBe("/triggers?tab=active#details");
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
        currentLocationHref: "/triggers",
        currentPathname: "/triggers",
        previousLocationHref: "/dashboard",
      }),
    ).toBeNull();
  });
});
