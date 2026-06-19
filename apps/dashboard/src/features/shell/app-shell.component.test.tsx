import { SidebarProvider } from "@mistle/ui";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { SessionsShellSidebar } from "../navigation/sessions-shell-sidebar.js";
import { resolveAppShellFrame } from "./app-shell-frame.js";
import { resolveAppShellRouteState } from "./app-shell-route-state.js";
import { AppSidebarHeader } from "./app-sidebar-header.js";

const CurrentDashboardBuildDriftStatus = {
  kind: "current",
  clientReleaseVersion: "0.18.1",
  serverReleaseVersion: "0.18.1",
} as const;

describe("resolveAppShellFrame", () => {
  it("uses the dedicated sessions sidebar only when the toggle is enabled on sessions routes", () => {
    const locationPathname = "/sessions/sbi_123";
    const routeState = resolveAppShellRouteState(locationPathname);
    const frame = resolveAppShellFrame({
      handleBackToApp: () => {},
      handleNavigateToSettings: () => {},
      handleSignOut: () => {},
      handleSwitchOrganization: () => {},
      inSessions: routeState.inSessions,
      inSettings: routeState.inSettings,
      isSigningOut: false,
      isSwitchingOrganization: false,
      locationPathname,
      organizationOptions: [],
      organizationSummaryErrorMessage: null,
      organizationSwitcherErrorMessage: null,
      organizationImageUrl: null,
      activeOrganizationId: "org_123",
      dashboardBuildDriftStatus: CurrentDashboardBuildDriftStatus,
      organizationName: "Acme",
      pageMeta: {
        appShellInsetOwner: "app-shell",
        appShellViewportMode: "document",
        sidebarTriggerOwner: "workspace",
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
    expect(frame.renderSidebarTrigger).toBe(false);
  });

  it("keeps the normal app sidebar when the sessions toggle is disabled", () => {
    const locationPathname = "/sessions/sbi_123";
    const routeState = resolveAppShellRouteState(locationPathname);
    const frame = resolveAppShellFrame({
      handleBackToApp: () => {},
      handleNavigateToSettings: () => {},
      handleSignOut: () => {},
      handleSwitchOrganization: () => {},
      inSessions: routeState.inSessions,
      inSettings: routeState.inSettings,
      isSigningOut: false,
      isSwitchingOrganization: false,
      locationPathname,
      organizationOptions: [],
      organizationSummaryErrorMessage: null,
      organizationSwitcherErrorMessage: null,
      organizationImageUrl: null,
      activeOrganizationId: "org_123",
      dashboardBuildDriftStatus: CurrentDashboardBuildDriftStatus,
      organizationName: "Acme",
      pageMeta: {
        appShellInsetOwner: "app-shell",
        appShellViewportMode: "document",
        sidebarTriggerOwner: "workspace",
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
    expect(isValidElement(frame.sidebarHeaderContent)).toBe(true);
    if (!isValidElement(frame.sidebarHeaderContent)) {
      throw new Error("Expected sidebar header content to be a React element.");
    }
    expect(frame.sidebarHeaderContent.type).toBe(AppSidebarHeader);
    expect(frame.renderSidebarTrigger).toBe(false);
  });

  it("hides Designer from the main app sidebar", () => {
    const locationPathname = "/";
    const routeState = resolveAppShellRouteState(locationPathname);
    const frame = resolveAppShellFrame({
      handleBackToApp: () => {},
      handleNavigateToSettings: () => {},
      handleSignOut: () => {},
      handleSwitchOrganization: () => {},
      inSessions: routeState.inSessions,
      inSettings: routeState.inSettings,
      isSigningOut: false,
      isSwitchingOrganization: false,
      locationPathname,
      organizationOptions: [],
      organizationSummaryErrorMessage: null,
      organizationSwitcherErrorMessage: null,
      organizationImageUrl: null,
      activeOrganizationId: "org_123",
      dashboardBuildDriftStatus: CurrentDashboardBuildDriftStatus,
      organizationName: "Acme",
      pageMeta: {
        appShellInsetOwner: "app-shell",
        appShellViewportMode: "document",
        sidebarTriggerOwner: "page-frame",
        title: "Home",
        headerIcon: null,
        supportingText: null,
      },
      signOutError: null,
      showSessionsSidebar: false,
      onShowSessionsSidebarChange: () => {},
    });

    const sidebarMarkup = renderToStaticMarkup(
      <MemoryRouter>
        <SidebarProvider>{frame.sidebarContent}</SidebarProvider>
      </MemoryRouter>,
    );

    expect(sidebarMarkup).not.toContain("Designer");
    expect(sidebarMarkup).toContain("Home");
  });

  it("keeps the sidebar trigger available for non-session-detail pages", () => {
    const locationPathname = "/integrations";
    const routeState = resolveAppShellRouteState(locationPathname);
    const frame = resolveAppShellFrame({
      handleBackToApp: () => {},
      handleNavigateToSettings: () => {},
      handleSignOut: () => {},
      handleSwitchOrganization: () => {},
      inSessions: routeState.inSessions,
      inSettings: routeState.inSettings,
      isSigningOut: false,
      isSwitchingOrganization: false,
      locationPathname,
      organizationOptions: [],
      organizationSummaryErrorMessage: null,
      organizationSwitcherErrorMessage: null,
      organizationImageUrl: null,
      activeOrganizationId: "org_123",
      dashboardBuildDriftStatus: CurrentDashboardBuildDriftStatus,
      organizationName: "Acme",
      pageMeta: {
        appShellInsetOwner: "child",
        appShellViewportMode: "document",
        sidebarTriggerOwner: "page-frame",
        title: "Integrations",
        headerIcon: null,
        supportingText: "",
      },
      signOutError: null,
      showSessionsSidebar: false,
      onShowSessionsSidebarChange: () => {},
    });

    expect(frame.renderSidebarTrigger).toBe(true);
  });
});
