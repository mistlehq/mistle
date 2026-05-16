import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@mistle/ui";
import { HouseIcon, LightningIcon, PackageIcon, PuzzlePieceIcon } from "@phosphor-icons/react";
import { NavLink } from "react-router";

import { ErrorNotice } from "../auth/error-notice.js";
import type { AppPageMeta } from "../navigation/route-meta.js";
import { SessionsNavToggleItem } from "../navigation/sessions-nav-toggle-item.js";
import { SessionsShellSidebar } from "../navigation/sessions-shell-sidebar.js";
import { SessionsSidebarHeader } from "../navigation/sessions-sidebar-header.js";
import { SettingsBackButton } from "../settings/settings-back-button.js";
import { SettingsSectionNav } from "../settings/settings-section-nav.js";
import { AppShellView } from "./app-shell-view.js";
import { AppSidebarHeader } from "./app-sidebar-header.js";
import type { OrganizationSwitcherOption } from "./organization-switcher.js";
import { TopLoadingBar } from "./top-loading-bar.js";

function HomeNavIcon(props: { className?: string; "aria-hidden"?: boolean }): React.JSX.Element {
  return <HouseIcon {...props} />;
}

function SandboxProfilesNavIcon(props: {
  className?: string;
  "aria-hidden"?: boolean;
}): React.JSX.Element {
  return <PackageIcon {...props} />;
}

function TriggersNavIcon(props: {
  className?: string;
  "aria-hidden"?: boolean;
}): React.JSX.Element {
  return <LightningIcon {...props} />;
}

function IntegrationsNavIcon(props: {
  className?: string;
  "aria-hidden"?: boolean;
}): React.JSX.Element {
  return <PuzzlePieceIcon {...props} />;
}

export type AppShellFrame = Pick<
  React.ComponentProps<typeof AppShellView>,
  | "contentInsetOwner"
  | "renderSidebarTrigger"
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
  handleSwitchOrganization: (organizationId: string) => void;
  inDashboardRoot: boolean;
  inIntegrations: boolean;
  inSandboxProfiles: boolean;
  inSessionDetail: boolean;
  inSessions: boolean;
  inSettings: boolean;
  isSigningOut: boolean;
  isSwitchingOrganization: boolean;
  locationPathname: string;
  organizationOptions: OrganizationSwitcherOption[];
  organizationSummaryErrorMessage: string | null;
  organizationSwitcherErrorMessage: string | null;
  organizationImageUrl: string | null;
  activeOrganizationId: string;
  organizationName: string;
  pageMeta: AppPageMeta;
  signOutError: string | null;
  showSessionsSidebar: boolean;
  onShowSessionsSidebarChange: (checked: boolean) => void;
}): AppShellFrame {
  const showDedicatedSessionsSidebar = input.inSessions && input.showSessionsSidebar;

  if (input.inSettings) {
    return {
      contentInsetOwner: "child",
      renderSidebarTrigger: true,
      sidebarContent: <SettingsSectionNav />,
      sidebarFooterContent: <ErrorNotice message={input.signOutError} />,
      sidebarHeaderClassName: "pb-0",
      sidebarHeaderContent: <SettingsBackButton onBack={input.handleBackToApp} />,
      topLoadingBar: <TopLoadingBar />,
      viewportMode: input.pageMeta.appShellViewportMode,
    };
  }

  return {
    contentInsetOwner: input.pageMeta.appShellInsetOwner,
    renderSidebarTrigger: !input.inSessionDetail,
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
      <AppSidebarHeader
        activeOrganizationId={input.activeOrganizationId}
        isSigningOut={input.isSigningOut}
        isSwitchingOrganization={input.isSwitchingOrganization}
        onNavigateToSettings={input.handleNavigateToSettings}
        onSignOut={input.handleSignOut}
        onSwitchOrganization={input.handleSwitchOrganization}
        organizationSummaryErrorMessage={input.organizationSummaryErrorMessage}
        organizationSwitcherErrorMessage={input.organizationSwitcherErrorMessage}
        organizationImageUrl={input.organizationImageUrl}
        organizationName={input.organizationName}
        organizations={input.organizationOptions}
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
              <HomeNavIcon aria-hidden className="size-5 shrink-0 md:size-4" />
              <span>Home</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={
                input.locationPathname === "/integrations" ||
                input.locationPathname.startsWith("/integrations/")
              }
              render={<NavLink to="/integrations" />}
            >
              <IntegrationsNavIcon aria-hidden className="size-5 shrink-0 md:size-4" />
              <span>Integrations</span>
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
              <SandboxProfilesNavIcon aria-hidden className="size-5 shrink-0 md:size-4" />
              <span>Sandbox Profiles</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={
                input.locationPathname === "/triggers" ||
                input.locationPathname.startsWith("/triggers/")
              }
              render={<NavLink to="/triggers" />}
            >
              <TriggersNavIcon aria-hidden className="size-5 shrink-0 md:size-4" />
              <span>Triggers</span>
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
