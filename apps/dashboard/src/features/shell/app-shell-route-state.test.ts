import { describe, expect, it } from "vitest";

import { resolveAppShellRouteState } from "./app-shell-route-state.js";

describe("resolveAppShellRouteState", () => {
  it("marks session detail routes as in-session", () => {
    expect(resolveAppShellRouteState("/sessions/sbi_123")).toEqual({
      inSessions: true,
      inSettings: false,
    });
  });

  it("marks the new-session route as in-sessions", () => {
    expect(resolveAppShellRouteState("/sessions/new")).toEqual({
      inSessions: true,
      inSettings: false,
    });
  });

  it("marks non-session routes independently", () => {
    expect(resolveAppShellRouteState("/settings/account/profile")).toEqual({
      inSessions: false,
      inSettings: true,
    });
  });

  it("marks integrations routes independently from settings", () => {
    expect(resolveAppShellRouteState("/integrations/github")).toEqual({
      inSessions: false,
      inSettings: false,
    });
  });
});
