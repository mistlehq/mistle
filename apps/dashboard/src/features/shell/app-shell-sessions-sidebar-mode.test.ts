import { describe, expect, it } from "vitest";

import {
  isExistingSandboxSessionPath,
  shouldNavigateToNewSessionOnSidebarModeEnable,
} from "./app-shell-sessions-sidebar-mode.js";

describe("app shell sessions sidebar mode routing", () => {
  it("treats existing sandbox session detail routes as in-place sidebar toggles", () => {
    expect(isExistingSandboxSessionPath("/sessions/sbi_123")).toBe(true);
    expect(shouldNavigateToNewSessionOnSidebarModeEnable("/sessions/sbi_123")).toBe(false);
  });

  it("routes the sessions index into the new-session page when enabling sidebar mode", () => {
    expect(isExistingSandboxSessionPath("/sessions")).toBe(false);
    expect(shouldNavigateToNewSessionOnSidebarModeEnable("/sessions")).toBe(true);
  });

  it("keeps the dedicated new-session route as the landing target when enabling sidebar mode", () => {
    expect(isExistingSandboxSessionPath("/sessions/new")).toBe(false);
    expect(shouldNavigateToNewSessionOnSidebarModeEnable("/sessions/new")).toBe(true);
  });

  it("routes non-session pages into the new-session page when enabling sidebar mode", () => {
    expect(isExistingSandboxSessionPath("/automations")).toBe(false);
    expect(shouldNavigateToNewSessionOnSidebarModeEnable("/automations")).toBe(true);
  });
});
