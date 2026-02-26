import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@mistle/ui";
import { CpuIcon, HouseIcon, TerminalIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";

import type { SidebarNavGroup } from "../navigation/sidebar-nav-model.js";

import { authClient } from "../../lib/auth/client.js";
import { ErrorNotice } from "../auth/error-notice.js";
import { resolveErrorMessage } from "../auth/messages.js";
import { AppBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { SidebarNavGroups } from "../navigation/sidebar-nav-groups.js";
import { OrganizationMenuTrigger } from "./organization-menu-trigger.js";
import { clearAuthenticatedSessionCache } from "./session-cache.js";
import { TopLoadingBar } from "./top-loading-bar.js";
import { useOrganizationSummary } from "./use-organization-summary.js";

const MAIN_NAV_GROUPS: readonly SidebarNavGroup[] = [
  {
    items: [
      { to: "/", label: "Home", icon: HomeNavIcon, matchMode: "exact" },
      { to: "/sandbox-profiles", label: "Sandbox Profiles", icon: SandboxProfilesNavIcon },
      { to: "/sessions", label: "Sessions", icon: SessionsNavIcon },
    ],
  },
];

const DASHBOARD_SIDEBAR_WIDTH = "14rem";
const SETTINGS_DEFAULT_PATH = "/settings/account/profile";

function isSettingsPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

function HomeNavIcon(props: { className?: string; "aria-hidden"?: boolean }): React.JSX.Element {
  return <HouseIcon {...props} />;
}

function SandboxProfilesNavIcon(props: {
  className?: string;
  "aria-hidden"?: boolean;
}): React.JSX.Element {
  return <CpuIcon {...props} />;
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
  const inSettings = isSettingsPath(location.pathname);

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
    await navigate(previousNonSettingsPathRef.current, { replace: true });
  }

  async function handleNavigateToSettings(): Promise<void> {
    await navigate(SETTINGS_DEFAULT_PATH);
  }

  return (
    <SidebarProvider style={{ "--sidebar-width": DASHBOARD_SIDEBAR_WIDTH } as React.CSSProperties}>
      <Sidebar>
        <SidebarHeader className={inSettings ? "pb-0" : undefined}>
          <div>
            {inSettings ? (
              <button
                className="text-muted-foreground hover:text-foreground text-sm"
                onClick={() => {
                  void handleBackToApp();
                }}
                type="button"
              >
                Back to app
              </button>
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
            )}
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarNavGroups
            groups={MAIN_NAV_GROUPS}
            pathname={location.pathname}
            showGroupLabel={false}
          />
        </SidebarContent>
        <SidebarFooter>
          <ErrorNotice message={signOutError} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <TopLoadingBar />
        <header className="bg-background/80 sticky top-0 z-10 flex h-12 items-center border-b px-4 backdrop-blur-sm">
          <SidebarTrigger className="-ml-1" />
          <div className="ml-2 min-w-0 flex-1">
            <AppBreadcrumbs />
          </div>
        </header>
        <div className="min-w-0 flex flex-1 flex-col px-4 py-6">
          <div className="min-w-0 flex-1">
            <Outlet />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
