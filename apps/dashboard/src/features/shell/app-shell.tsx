import { CpuIcon, HouseIcon, LightningIcon, TerminalIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";

import { authClient } from "../../lib/auth/client.js";
import { ErrorNotice } from "../auth/error-notice.js";
import { resolveErrorMessage } from "../auth/messages.js";
import { AppBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { SidebarNavGroups } from "../navigation/sidebar-nav-groups.js";
import type { SidebarNavGroup } from "../navigation/sidebar-nav-model.js";
import { useOrganizationLogoQuery } from "../organizations/organization-logo-query.js";
import {
  isSettingsPath,
  resolveSettingsBackDestination,
  SETTINGS_DEFAULT_PATH,
} from "../settings/model.js";
import { SettingsBackButton } from "../settings/settings-back-button.js";
import { SettingsSectionNav } from "../settings/settings-section-nav.js";
import {
  createOrganizationLogoContentPath,
  createSingletonImageContentUrl,
} from "../shared/singleton-image.js";
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

type AppShellFrame = Pick<
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

export function AppShell(): React.JSX.Element {
  const organizationSummary = useOrganizationSummary();
  const organizationLogoQuery = useOrganizationLogoQuery(organizationSummary.activeOrganizationId);
  const pageMeta = useAppPageMeta();
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

  const appShellFrame = resolveAppShellFrame({
    handleBackToApp: () => {
      void handleBackToApp();
    },
    handleNavigateToSettings: () => {
      void handleNavigateToSettings();
    },
    handleSignOut: () => {
      void handleSignOut();
    },
    inAutomations,
    inDashboardRoot,
    inSandboxProfiles,
    inSessionDetail,
    inSessions,
    inSettings,
    isSigningOut,
    locationPathname: location.pathname,
    organizationErrorMessage: organizationSummary.organizationErrorMessage,
    organizationImageUrl: createSingletonImageContentUrl({
      resourceName: "Organization logo",
      path: createOrganizationLogoContentPath(organizationSummary.activeOrganizationId),
      image: organizationLogoQuery.data,
    }),
    organizationName: organizationSummary.organizationName ?? "",
    pageMeta,
    signOutError,
  });

  return (
    <AppShellHeaderActionsContext.Provider value={setHeaderActions}>
      <AppShellView headerActions={headerActions} mainContent={<Outlet />} {...appShellFrame} />
    </AppShellHeaderActionsContext.Provider>
  );
}

function resolveAppShellFrame(input: {
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
  pageMeta: ReturnType<typeof useAppPageMeta>;
  signOutError: string | null;
}): AppShellFrame {
  const showBreadcrumbs =
    input.inSettings ||
    input.inSandboxProfiles ||
    input.inAutomations ||
    input.inDashboardRoot ||
    input.inSessions;

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
    sidebarContent: (
      <SidebarNavGroups
        groups={MAIN_NAV_GROUPS}
        pathname={input.locationPathname}
        showGroupLabel={false}
      />
    ),
    sidebarFooterContent: <ErrorNotice message={input.signOutError} />,
    sidebarHeaderContent: (
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
