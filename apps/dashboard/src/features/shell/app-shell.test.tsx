import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { SessionsShellSidebar } from "../navigation/sessions-shell-sidebar.js";
import { resolveAppShellFrame } from "./app-shell-frame.js";

describe("resolveAppShellFrame", () => {
  it("uses the dedicated sessions sidebar only when the toggle is enabled on sessions routes", () => {
    const frame = resolveAppShellFrame({
      handleBackToApp: () => {},
      handleNavigateToSettings: () => {},
      handleSignOut: () => {},
      inAutomations: false,
      inDashboardRoot: false,
      inSandboxProfiles: false,
      inSessionDetail: true,
      inSessions: true,
      inSettings: false,
      isSigningOut: false,
      locationPathname: "/sessions/sbi_123",
      organizationErrorMessage: null,
      organizationImageUrl: null,
      organizationName: "Acme",
      pageMeta: {
        appShellInsetOwner: "app-shell",
        appShellViewportMode: "document",
        title: "Sessions",
        headerIcon: null,
        supportingText: null,
      },
      signOutError: null,
      showSessionsSidebar: true,
      onShowSessionsSidebarChange: () => {},
    });

    expect(isValidElement<{ children: ReactNode[]; className: string }>(frame.sidebarContent)).toBe(
      true,
    );
    if (!isValidElement<{ children: ReactNode[]; className: string }>(frame.sidebarContent)) {
      throw new Error("Expected sidebar content to be a React element.");
    }
    expect(frame.sidebarContent.props.className).toBe("animate-in fade-in-0 duration-200");
    const sidebarChildren = frame.sidebarContent.props.children;
    expect(Array.isArray(sidebarChildren)).toBe(true);
    const sessionsSidebarElement = sidebarChildren[1];
    expect(isValidElement(sessionsSidebarElement)).toBe(true);
    if (!isValidElement(sessionsSidebarElement)) {
      throw new Error("Expected sessions sidebar element.");
    }
    expect(sessionsSidebarElement.type).toBe(SessionsShellSidebar);
    expect(frame.sidebarHeaderContent).toBeNull();
  });

  it("keeps the normal app sidebar when the sessions toggle is disabled", () => {
    const frame = resolveAppShellFrame({
      handleBackToApp: () => {},
      handleNavigateToSettings: () => {},
      handleSignOut: () => {},
      inAutomations: false,
      inDashboardRoot: false,
      inSandboxProfiles: false,
      inSessionDetail: true,
      inSessions: true,
      inSettings: false,
      isSigningOut: false,
      locationPathname: "/sessions/sbi_123",
      organizationErrorMessage: null,
      organizationImageUrl: null,
      organizationName: "Acme",
      pageMeta: {
        appShellInsetOwner: "app-shell",
        appShellViewportMode: "document",
        title: "Sessions",
        headerIcon: null,
        supportingText: null,
      },
      signOutError: null,
      showSessionsSidebar: false,
      onShowSessionsSidebarChange: () => {},
    });

    expect(isValidElement(frame.sidebarContent)).toBe(true);
    if (!isValidElement(frame.sidebarContent)) {
      throw new Error("Expected sidebar content to be a React element.");
    }
    expect(frame.sidebarContent.type).not.toBe(SessionsShellSidebar);
    expect(frame.sidebarHeaderContent).not.toBeNull();
  });
});
