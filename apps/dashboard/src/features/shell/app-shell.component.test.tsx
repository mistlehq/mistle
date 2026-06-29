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

type ResolveAppShellFrameInput = Parameters<typeof resolveAppShellFrame>[0];

function createFrameInput(
  overrides: Partial<ResolveAppShellFrameInput> = {},
): ResolveAppShellFrameInput {
  const locationPathname = overrides.locationPathname ?? "/";
  const routeState = resolveAppShellRouteState(locationPathname);

  return {
    handleBackToApp: () => {},
    handleCreateNewOrganization: () => {},
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
      sidebarEntryState: null,
      sidebarTriggerOwner: "workspace",
      title: "Home",
      headerIcon: null,
      supportingText: null,
    },
    signOutError: null,
    showSessionsSidebar: false,
    onShowSessionsSidebarChange: () => {},
    ...overrides,
  };
}

describe("resolveAppShellFrame", () => {
  it("uses the dedicated sessions sidebar only when the toggle is enabled on sessions routes", () => {
    const frame = resolveAppShellFrame(
      createFrameInput({
        locationPathname: "/sessions/sbi_123",
        pageMeta: {
          appShellInsetOwner: "app-shell",
          appShellViewportMode: "document",
          sidebarEntryState: null,
          sidebarTriggerOwner: "workspace",
          title: "Sessions",
          headerIcon: null,
          supportingText: null,
        },
        showSessionsSidebar: true,
      }),
    );

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
    const frame = resolveAppShellFrame(
      createFrameInput({
        locationPathname: "/sessions/sbi_123",
        pageMeta: {
          appShellInsetOwner: "app-shell",
          appShellViewportMode: "document",
          sidebarEntryState: null,
          sidebarTriggerOwner: "workspace",
          title: "Sessions",
          headerIcon: null,
          supportingText: null,
        },
      }),
    );

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
    const frame = resolveAppShellFrame(
      createFrameInput({
        locationPathname: "/",
        pageMeta: {
          appShellInsetOwner: "app-shell",
          appShellViewportMode: "document",
          sidebarEntryState: null,
          sidebarTriggerOwner: "page-frame",
          title: "Home",
          headerIcon: null,
          supportingText: null,
        },
      }),
    );

    const sidebarMarkup = renderToStaticMarkup(
      <MemoryRouter>
        <SidebarProvider>{frame.sidebarContent}</SidebarProvider>
      </MemoryRouter>,
    );

    expect(sidebarMarkup).not.toContain("Designer");
    expect(sidebarMarkup).toContain("Home");
  });

  it("keeps the sidebar trigger available for non-session-detail pages", () => {
    const frame = resolveAppShellFrame(
      createFrameInput({
        locationPathname: "/integrations",
        pageMeta: {
          appShellInsetOwner: "child",
          appShellViewportMode: "document",
          sidebarEntryState: null,
          sidebarTriggerOwner: "page-frame",
          title: "Integrations",
          headerIcon: null,
          supportingText: "",
        },
      }),
    );

    expect(frame.renderSidebarTrigger).toBe(true);
  });

  it("passes explicit route sidebar entry state into the shell view frame", () => {
    const frame = resolveAppShellFrame(
      createFrameInput({
        locationPathname: "/designer/dsn_123",
        pageMeta: {
          appShellInsetOwner: "app-shell",
          appShellViewportMode: "workspace",
          sidebarEntryState: "collapsed",
          sidebarTriggerOwner: "workspace",
          title: "Designer",
          headerIcon: null,
          supportingText: "",
        },
      }),
    );

    expect(frame.sidebarEntryKey).toBe("/designer/dsn_123");
    expect(frame.sidebarEntryState).toBe("collapsed");
  });
});
