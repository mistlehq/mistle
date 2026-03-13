import { CpuIcon, HouseIcon, LightningIcon, TerminalIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";

import { authClient } from "../../lib/auth/client.js";
import { ErrorNotice } from "../auth/error-notice.js";
import { resolveErrorMessage } from "../auth/messages.js";
import { AppBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { SidebarNavGroups } from "../navigation/sidebar-nav-groups.js";
import type { SidebarNavGroup } from "../navigation/sidebar-nav-model.js";
import {
  isSettingsPath,
  resolveSettingsBackDestination,
  SETTINGS_DEFAULT_PATH,
} from "../settings/model.js";
import { SettingsBackButton } from "../settings/settings-back-button.js";
import { SettingsSectionNav } from "../settings/settings-section-nav.js";
import { AppShellHeaderActionsContext } from "./app-shell-header-actions.js";
import { AppShellView } from "./app-shell-view.js";
import { OrganizationMenuTrigger } from "./organization-menu-trigger.js";
import { clearAuthenticatedSessionCache } from "./session-cache.js";
import { TopLoadingBar } from "./top-loading-bar.js";
import { useOrganizationSummary } from "./use-organization-summary.js";

const MAIN_NAV_GROUPS: readonly SidebarNavGroup[] = [
  {
    items: [
      { to: "/", label: "Home", icon: HomeNavIcon, matchMode: "exact" },
      { to: "/automations", label: "Automations", icon: AutomationsNavIcon },
      { to: "/sandbox-profiles", label: "Sandbox Profiles", icon: SandboxProfilesNavIcon },
      { to: "/sessions", label: "Sessions", icon: SessionsNavIcon },
    ],
  },
];

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

function SessionsNavIcon(props: {
  className?: string;
  "aria-hidden"?: boolean;
}): React.JSX.Element {
  return <TerminalIcon {...props} />;
}

export function AppShell(): React.JSX.Element {
  const organizationSummary = useOrganizationSummary();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const previousNonSettingsPathRef = useRef<string>("/");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [headerActions, setHeaderActions] = useState<React.ReactNode | null>(null);
  const inSettings = isSettingsPath(location.pathname);
  const inSandboxProfiles =
    location.pathname === "/sandbox-profiles" || location.pathname.startsWith("/sandbox-profiles/");
  const inAutomations =
    location.pathname === "/automations" || location.pathname.startsWith("/automations/");
  const inDashboardRoot = location.pathname === "/";
  const inSessions =
    location.pathname === "/sessions" || location.pathname.startsWith("/sessions/");
  const inSessionDetail = location.pathname.startsWith("/sessions/");
  const showBreadcrumbs =
    inSettings || inSandboxProfiles || inAutomations || inDashboardRoot || inSessions;

  useEffect(() => {
    if (!isSettingsPath(location.pathname)) {
      previousNonSettingsPathRef.current = location.pathname;
    }
  }, [location.pathname]);

  async function handleSignOut(): Promise<void> {
    setSignOutError(null);
    setIsSigningOut(true);
    const response = await authClient.signOut();
    setIsSigningOut(false);

    if (response.error) {
      setSignOutError(resolveErrorMessage(response.error, "Unable to sign out."));
      return;
    }

    clearAuthenticatedSessionCache(queryClient);
    await navigate("/auth/login", { replace: true });
  }

  async function handleBackToApp(): Promise<void> {
    await navigate(resolveSettingsBackDestination(previousNonSettingsPathRef.current), {
      replace: true,
    });
  }

  async function handleNavigateToSettings(): Promise<void> {
    await navigate(SETTINGS_DEFAULT_PATH);
  }

  return (
    <AppShellHeaderActionsContext.Provider value={setHeaderActions}>
      <AppShellView
        breadcrumbs={showBreadcrumbs ? <AppBreadcrumbs /> : null}
        headerActions={headerActions}
        isSessionDetail={inSessionDetail}
        mainContent={<Outlet />}
        showBreadcrumbs={showBreadcrumbs}
        sidebarContent={
          inSettings ? (
            <SettingsSectionNav />
          ) : (
            <SidebarNavGroups
              groups={MAIN_NAV_GROUPS}
              pathname={location.pathname}
              showGroupLabel={false}
            />
          )
        }
        sidebarFooterContent={<ErrorNotice message={signOutError} />}
        sidebarHeaderContent={
          inSettings ? (
            <SettingsBackButton
              onBack={() => {
                void handleBackToApp();
              }}
            />
          ) : (
            <OrganizationMenuTrigger
              isSigningOut={isSigningOut}
              onNavigateToSettings={() => {
                void handleNavigateToSettings();
              }}
              onSignOut={() => {
                void handleSignOut();
              }}
              organizationErrorMessage={organizationSummary.organizationErrorMessage}
              organizationName={organizationSummary.organizationName}
            />
          )
        }
        topLoadingBar={<TopLoadingBar />}
        {...(inSettings ? { sidebarHeaderClassName: "pb-0" } : {})}
      />
    </AppShellHeaderActionsContext.Provider>
  );
}
