import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";

import { authClient } from "../../lib/auth/client.js";
import { AUTH_SWITCH_ORGANIZATION_PATH } from "../auth/auth-switch-organization-page.js";
import { resolveErrorMessage } from "../auth/messages.js";
import { AppBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { useAppHeaderLeadingModel, useAppPageMeta } from "../navigation/route-meta.js";
import { useOrganizationLogoQuery } from "../organizations/organization-logo-query.js";
import { resolveSettingsBackDestination, SETTINGS_DEFAULT_PATH } from "../settings/model.js";
import {
  getBestEffortBrowserStorage,
  readBrowserStorageItem,
  writeBrowserStorageItem,
} from "../shared/browser-storage.js";
import {
  createOrganizationLogoContentPath,
  createSingletonImageContentUrl,
} from "../shared/singleton-image.js";
import { resolveAppShellFrame } from "./app-shell-frame.js";
import { AppShellHeaderActionsContext } from "./app-shell-header-actions.js";
import { resolveAppShellRouteState } from "./app-shell-route-state.js";
import {
  resolveLocationHref,
  resolveSidebarModeDisableNavigationTarget,
  resolveSidebarModeEnableNavigationTarget,
} from "./app-shell-sessions-sidebar-mode.js";
import { AppShellView } from "./app-shell-view.js";
import {
  fetchOrganizationSwitcherOptions,
  ORGANIZATION_SWITCHER_QUERY_KEY,
  switchActiveOrganization,
} from "./organization-switcher.js";
import { clearAuthenticatedSessionCache } from "./session-cache.js";
import { useOrganizationSummary } from "./use-organization-summary.js";

const SESSIONS_SIDEBAR_MODE_STORAGE_KEY = "dashboard.sessions-sidebar.enabled";

export function AppShell(): React.JSX.Element {
  const organizationSummary = useOrganizationSummary();
  const organizationLogoQuery = useOrganizationLogoQuery(organizationSummary.activeOrganizationId);
  const headerLeadingModel = useAppHeaderLeadingModel();
  const pageMeta = useAppPageMeta();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const previousNonSettingsPathRef = useRef<string>("/");
  const previousSessionsSidebarToggleUrlRef = useRef<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSwitchingOrganization, setIsSwitchingOrganization] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [switchOrganizationError, setSwitchOrganizationError] = useState<string | null>(null);
  const [headerActions, setHeaderActions] = useState<React.ReactNode | null>(null);
  const [showSessionsSidebar, setShowSessionsSidebar] = useState(() =>
    readSessionsSidebarEnabledPreference(),
  );
  const routeState = resolveAppShellRouteState(location.pathname);

  useEffect(() => {
    if (!routeState.inSettings) {
      previousNonSettingsPathRef.current = location.pathname;
    }
  }, [location.pathname, routeState.inSettings]);

  useEffect(() => {
    persistSessionsSidebarEnabledPreference(showSessionsSidebar);
  }, [showSessionsSidebar]);

  useEffect(() => {
    if (showSessionsSidebar && !routeState.inSessions) {
      previousSessionsSidebarToggleUrlRef.current = null;
    }
  }, [routeState.inSessions, showSessionsSidebar]);

  const organizationOptionsQuery = useQuery({
    queryKey: ORGANIZATION_SWITCHER_QUERY_KEY,
    queryFn: fetchOrganizationSwitcherOptions,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const organizationSwitcherErrorMessage =
    switchOrganizationError ??
    (organizationOptionsQuery.error instanceof Error
      ? organizationOptionsQuery.error.message
      : null);

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

  async function handleSwitchOrganization(organizationId: string): Promise<void> {
    if (organizationId === organizationSummary.activeOrganizationId) {
      return;
    }

    setSwitchOrganizationError(null);
    setIsSwitchingOrganization(true);

    try {
      await switchActiveOrganization({
        organizationId,
      });
      globalThis.location.replace(AUTH_SWITCH_ORGANIZATION_PATH);
      return;
    } catch (error) {
      setSwitchOrganizationError(
        error instanceof Error ? error.message : "Unable to switch organization.",
      );
    } finally {
      setIsSwitchingOrganization(false);
    }
  }

  async function handleSessionsSidebarModeChange(nextChecked: boolean): Promise<void> {
    const currentLocationHref = resolveLocationHref({
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    });

    setShowSessionsSidebar(nextChecked);

    if (!nextChecked) {
      const navigationTarget = resolveSidebarModeDisableNavigationTarget({
        currentLocationHref,
        currentPathname: location.pathname,
        previousLocationHref: previousSessionsSidebarToggleUrlRef.current,
      });
      previousSessionsSidebarToggleUrlRef.current = null;

      if (navigationTarget === null) {
        return;
      }

      await navigate(navigationTarget);
      return;
    }

    previousSessionsSidebarToggleUrlRef.current = currentLocationHref;

    const navigationTarget = resolveSidebarModeEnableNavigationTarget(location.pathname);

    if (navigationTarget === null) {
      return;
    }

    await navigate(navigationTarget);
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
    handleSwitchOrganization: (organizationId) => {
      void handleSwitchOrganization(organizationId);
    },
    inAutomations: routeState.inAutomations,
    inDashboardRoot: routeState.inDashboardRoot,
    inIntegrations: routeState.inIntegrations,
    inSandboxProfiles: routeState.inSandboxProfiles,
    inSessionDetail: routeState.inSessionDetail,
    inSessions: routeState.inSessions,
    inSettings: routeState.inSettings,
    isSigningOut,
    isSwitchingOrganization,
    locationPathname: location.pathname,
    organizationOptions: organizationOptionsQuery.data ?? [],
    organizationSummaryErrorMessage: organizationSummary.organizationSummaryErrorMessage,
    organizationSwitcherErrorMessage,
    organizationImageUrl: createSingletonImageContentUrl({
      resourceName: "Organization logo",
      path: createOrganizationLogoContentPath(organizationSummary.activeOrganizationId),
      image: organizationLogoQuery.data,
    }),
    activeOrganizationId: organizationSummary.activeOrganizationId,
    organizationName: organizationSummary.organizationName ?? "",
    pageMeta,
    signOutError,
    showSessionsSidebar,
    onShowSessionsSidebarChange: (checked) => {
      void handleSessionsSidebarModeChange(checked);
    },
  });

  return (
    <AppShellHeaderActionsContext.Provider value={setHeaderActions}>
      <AppShellView
        headerLeadingContent={
          headerLeadingModel.kind === "custom" ? (
            <>{headerLeadingModel.content}</>
          ) : headerLeadingModel.kind === "breadcrumbs" ? (
            <AppBreadcrumbs breadcrumbs={headerLeadingModel.breadcrumbs} />
          ) : null
        }
        headerActions={headerActions}
        mainContent={<Outlet />}
        {...appShellFrame}
      />
    </AppShellHeaderActionsContext.Provider>
  );
}

function readSessionsSidebarEnabledPreference(): boolean {
  const storage = getBestEffortBrowserStorage("local");
  const storedValue = readBrowserStorageItem({
    key: SESSIONS_SIDEBAR_MODE_STORAGE_KEY,
    storage,
  });

  return storedValue === "true";
}

function persistSessionsSidebarEnabledPreference(enabled: boolean): void {
  const storage = getBestEffortBrowserStorage("local");
  writeBrowserStorageItem({
    key: SESSIONS_SIDEBAR_MODE_STORAGE_KEY,
    value: enabled ? "true" : "false",
    storage,
  });
}
