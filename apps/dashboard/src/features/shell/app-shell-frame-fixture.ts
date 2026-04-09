import type { AppPageMeta } from "../navigation/route-meta.js";
import type { resolveAppShellFrame } from "./app-shell-frame.js";
import { resolveAppShellRouteState } from "./app-shell-route-state.js";

type AppShellFrameInput = Parameters<typeof resolveAppShellFrame>[0];

export function createAppShellFrameInput(input: {
  locationPathname?: string;
  pageMeta?: AppPageMeta;
  overrides?: Partial<AppShellFrameInput>;
}): AppShellFrameInput {
  const locationPathname = input.locationPathname ?? "/sessions/sbi_123";
  const routeState = resolveAppShellRouteState(locationPathname);

  return {
    handleBackToApp: () => {},
    handleNavigateToSettings: () => {},
    handleSignOut: () => {},
    handleSwitchOrganization: () => {},
    inAutomations: routeState.inAutomations,
    inDashboardRoot: routeState.inDashboardRoot,
    inSandboxProfiles: routeState.inSandboxProfiles,
    inSessionDetail: routeState.inSessionDetail,
    inSessions: routeState.inSessions,
    inSettings: routeState.inSettings,
    isSigningOut: false,
    isSwitchingOrganization: false,
    locationPathname,
    organizationOptions: [{ id: "org_123", name: "Mistle Labs" }],
    organizationSummaryErrorMessage: null,
    organizationSwitcherErrorMessage: null,
    organizationImageUrl: null,
    activeOrganizationId: "org_123",
    organizationName: "Mistle Labs",
    pageMeta: input.pageMeta ?? {
      appShellInsetOwner: "app-shell",
      appShellViewportMode: "document",
      title: null,
      headerIcon: null,
      supportingText: null,
    },
    signOutError: null,
    showSessionsSidebar: false,
    onShowSessionsSidebarChange: () => {},
    ...(input.overrides ?? {}),
  };
}
