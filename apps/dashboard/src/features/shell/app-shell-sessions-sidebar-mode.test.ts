import { describe, expect, it } from "vitest";

import {
  isExistingSandboxSessionPath,
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
});
