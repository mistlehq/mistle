import { describe, expect, it } from "vitest";

import { resolveAppShellRouteState } from "./app-shell-route-state.js";

describe("resolveAppShellRouteState", () => {
  it("marks session detail routes as in-session and in-session-detail", () => {
    expect(resolveAppShellRouteState("/sessions/sbi_123")).toEqual({
      inDashboardRoot: false,
      inIntegrations: false,
      inSandboxProfiles: false,
      inSessionDetail: true,
      inSessions: true,
      inSettings: false,
    });
  });

  it("marks the new-session route as in-sessions without treating it as a detail page", () => {
    expect(resolveAppShellRouteState("/sessions/new")).toEqual({
      inDashboardRoot: false,
      inIntegrations: false,
      inSandboxProfiles: false,
      inSessionDetail: false,
      inSessions: true,
      inSettings: false,
    });
  });

  it("marks non-session routes independently", () => {
    expect(resolveAppShellRouteState("/settings/account/profile")).toEqual({
      inDashboardRoot: false,
      inIntegrations: false,
      inSandboxProfiles: false,
      inSessionDetail: false,
      inSessions: false,
      inSettings: true,
    });
  });

  it("marks integrations routes independently from settings", () => {
    expect(resolveAppShellRouteState("/integrations/github")).toEqual({
      inDashboardRoot: false,
      inIntegrations: true,
      inSandboxProfiles: false,
      inSessionDetail: false,
      inSessions: false,
      inSettings: false,
    });
  });
});
