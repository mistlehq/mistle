import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@mistle/ui";
import { CpuIcon, HouseIcon, LightningIcon } from "@phosphor-icons/react";
import { NavLink } from "react-router";

import { ErrorNotice } from "../auth/error-notice.js";
import { AppBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import type { AppPageMeta } from "../navigation/route-meta.js";
import { SessionsNavToggleItem } from "../navigation/sessions-nav-toggle-item.js";
import { SessionsShellSidebar } from "../navigation/sessions-shell-sidebar.js";
import { SessionsSidebarHeader } from "../navigation/sessions-sidebar-header.js";
import { SettingsBackButton } from "../settings/settings-back-button.js";
import { SettingsSectionNav } from "../settings/settings-section-nav.js";
import { AppShellView } from "./app-shell-view.js";
import { OrganizationMenuTrigger } from "./organization-menu-trigger.js";
import { TopLoadingBar } from "./top-loading-bar.js";

function HomeNavIcon(props: { className?: string; "aria-hidden"?: boolean }): React.JSX.Element {
  return <HouseIcon {...props} />;
}

function SandboxProfilesNavIcon(props: {
  className?: string;
  "aria-hidden"?: boolean;
}): React.JSX.Element {
  return <CpuIcon {...props} />;
}

function AutomationsNavIcon(props: {
  className?: string;
  "aria-hidden"?: boolean;
}): React.JSX.Element {
  return <LightningIcon {...props} />;
}

export type AppShellFrame = Pick<
  React.ComponentProps<typeof AppShellView>,
  | "breadcrumbs"
  | "contentInsetOwner"
  | "showBreadcrumbs"
  | "sidebarContent"
  | "sidebarFooterContent"
  | "sidebarHeaderClassName"
  | "sidebarHeaderContent"
  | "topLoadingBar"
  | "viewportMode"
>;

export function resolveAppShellFrame(input: {
  handleBackToApp: () => void;
  handleNavigateToSettings: () => void;
  handleSignOut: () => void;
  inAutomations: boolean;
  inDashboardRoot: boolean;
  inSandboxProfiles: boolean;
  inSessionDetail: boolean;
  inSessions: boolean;
  inSettings: boolean;
  isSigningOut: boolean;
  locationPathname: string;
  organizationErrorMessage: string | null;
  organizationImageUrl: string | null;
  organizationName: string;
  pageMeta: AppPageMeta;
  signOutError: string | null;
  showSessionsSidebar: boolean;
  onShowSessionsSidebarChange: (checked: boolean) => void;
}): AppShellFrame {
  const showBreadcrumbs =
    input.inSettings ||
    input.inSandboxProfiles ||
    input.inAutomations ||
    input.inDashboardRoot ||
    input.inSessions;

  const showDedicatedSessionsSidebar = input.inSessions && input.showSessionsSidebar;

  if (input.inSettings) {
    return {
      breadcrumbs: showBreadcrumbs ? <AppBreadcrumbs /> : null,
      contentInsetOwner: "child",
      showBreadcrumbs,
      sidebarContent: <SettingsSectionNav />,
      sidebarFooterContent: <ErrorNotice message={input.signOutError} />,
      sidebarHeaderClassName: "pb-0",
      sidebarHeaderContent: <SettingsBackButton onBack={input.handleBackToApp} />,
      topLoadingBar: <TopLoadingBar />,
      viewportMode: input.pageMeta.appShellViewportMode,
    };
  }

  return {
    breadcrumbs: showBreadcrumbs ? <AppBreadcrumbs /> : null,
    contentInsetOwner: input.pageMeta.appShellInsetOwner,
    showBreadcrumbs,
    sidebarContent: showDedicatedSessionsSidebar ? (
      <div className="animate-in fade-in-0 duration-200">
        <SessionsSidebarHeader
          checked={input.showSessionsSidebar}
          onCheckedChange={input.onShowSessionsSidebarChange}
        />
        <SessionsShellSidebar />
      </div>
    ) : (
      <MainSidebarContent
        locationPathname={input.locationPathname}
        showSessionsSidebar={input.showSessionsSidebar}
        onShowSessionsSidebarChange={input.onShowSessionsSidebarChange}
      />
    ),
    sidebarFooterContent: <ErrorNotice message={input.signOutError} />,
    sidebarHeaderContent: showDedicatedSessionsSidebar ? null : (
      <OrganizationMenuTrigger
        isSigningOut={input.isSigningOut}
        onNavigateToSettings={input.handleNavigateToSettings}
        onSignOut={input.handleSignOut}
        organizationErrorMessage={input.organizationErrorMessage}
        organizationImageUrl={input.organizationImageUrl}
        organizationName={input.organizationName}
      />
    ),
    topLoadingBar: <TopLoadingBar />,
    viewportMode: input.inSessionDetail ? "workspace" : input.pageMeta.appShellViewportMode,
  };
}

function MainSidebarContent(input: {
  locationPathname: string;
  showSessionsSidebar: boolean;
  onShowSessionsSidebarChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <SidebarGroup className="pt-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={input.locationPathname === "/"}
              render={<NavLink to="/" />}
            >
              <HomeNavIcon aria-hidden className="size-4 shrink-0" />
              <span>Home</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={
                input.locationPathname === "/automations" ||
                input.locationPathname.startsWith("/automations/")
              }
              render={<NavLink to="/automations" />}
            >
              <AutomationsNavIcon aria-hidden className="size-4 shrink-0" />
              <span>Automations</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={
                input.locationPathname === "/sandbox-profiles" ||
                input.locationPathname.startsWith("/sandbox-profiles/")
              }
              render={<NavLink to="/sandbox-profiles" />}
            >
              <SandboxProfilesNavIcon aria-hidden className="size-4 shrink-0" />
              <span>Sandbox Profiles</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SessionsNavToggleItem
            checked={input.showSessionsSidebar}
            onCheckedChange={input.onShowSessionsSidebarChange}
          />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
