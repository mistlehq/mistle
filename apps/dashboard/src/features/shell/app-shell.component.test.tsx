import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { SessionsShellSidebar } from "../navigation/sessions-shell-sidebar.js";
import { resolveAppShellFrame } from "./app-shell-frame.js";
import { resolveAppShellRouteState } from "./app-shell-route-state.js";
import {
  shouldRenderAppShellSidebarTrigger,
  shouldRenderAppShellStickyHeader,
} from "./app-shell-view.js";

describe("resolveAppShellFrame", () => {
  it("uses the dedicated sessions sidebar only when the toggle is enabled on sessions routes", () => {
    const locationPathname = "/sessions/sbi_123";
    const routeState = resolveAppShellRouteState(locationPathname);
    const frame = resolveAppShellFrame({
      handleBackToApp: () => {},
      handleNavigateToSettings: () => {},
      handleSignOut: () => {},
      handleSwitchOrganization: () => {},
      inAutomations: routeState.inAutomations,
      inDashboardRoot: routeState.inDashboardRoot,
      inIntegrations: routeState.inIntegrations,
      inSandboxProfiles: routeState.inSandboxProfiles,
      inSessionDetail: routeState.inSessionDetail,
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
      organizationName: "Acme",
      pageMeta: {
        appShellHeaderLeadingVisible: true,
        appShellHeaderVisible: true,
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
    const locationPathname = "/sessions/sbi_123";
    const routeState = resolveAppShellRouteState(locationPathname);
    const frame = resolveAppShellFrame({
      handleBackToApp: () => {},
      handleNavigateToSettings: () => {},
      handleSignOut: () => {},
      handleSwitchOrganization: () => {},
      inAutomations: routeState.inAutomations,
      inDashboardRoot: routeState.inDashboardRoot,
      inIntegrations: routeState.inIntegrations,
      inSandboxProfiles: routeState.inSandboxProfiles,
      inSessionDetail: routeState.inSessionDetail,
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
      organizationName: "Acme",
      pageMeta: {
        appShellHeaderLeadingVisible: true,
        appShellHeaderVisible: true,
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

  it("keeps the app shell header hidden when route metadata does not opt in", () => {
    const locationPathname = "/integrations";
    const routeState = resolveAppShellRouteState(locationPathname);
    const frame = resolveAppShellFrame({
      handleBackToApp: () => {},
      handleNavigateToSettings: () => {},
      handleSignOut: () => {},
      handleSwitchOrganization: () => {},
      inAutomations: routeState.inAutomations,
      inDashboardRoot: routeState.inDashboardRoot,
      inIntegrations: routeState.inIntegrations,
      inSandboxProfiles: routeState.inSandboxProfiles,
      inSessionDetail: routeState.inSessionDetail,
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
      organizationName: "Acme",
      pageMeta: {
        appShellHeaderLeadingVisible: false,
        appShellHeaderVisible: false,
        appShellInsetOwner: "child",
        appShellViewportMode: "document",
        title: "Integrations",
        headerIcon: null,
        supportingText: "",
      },
      signOutError: null,
      showSessionsSidebar: false,
      onShowSessionsSidebarChange: () => {},
    });

    expect(frame.showHeader).toBe(false);
    expect(frame.showHeaderLeadingContent).toBe(false);
  });
});

describe("app shell sticky header visibility", () => {
  it("keeps the sticky header available when only the sidebar trigger is needed", () => {
    expect(
      shouldRenderAppShellStickyHeader({
        hasHeaderContent: false,
        hasSidebarTrigger: true,
      }),
    ).toBe(true);
  });

  it("omits the sticky header when neither header content nor sidebar trigger is needed", () => {
    expect(
      shouldRenderAppShellStickyHeader({
        hasHeaderContent: false,
        hasSidebarTrigger: false,
      }),
    ).toBe(false);
  });

  it("renders the sidebar trigger on mobile when the mobile sidebar is closed", () => {
    expect(
      shouldRenderAppShellSidebarTrigger({
        isMobile: true,
        openMobile: false,
        sidebarState: "expanded",
      }),
    ).toBe(true);
  });

  it("renders the sidebar trigger on desktop when the sidebar is collapsed", () => {
    expect(
      shouldRenderAppShellSidebarTrigger({
        isMobile: false,
        openMobile: false,
        sidebarState: "collapsed",
      }),
    ).toBe(true);
  });
});
