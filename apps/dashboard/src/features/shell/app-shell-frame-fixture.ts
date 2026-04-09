import type { AppPageMeta } from "../navigation/route-meta.js";
import type { resolveAppShellFrame } from "./app-shell-frame.js";
import type { resolveAppShellRouteState } from "./app-shell-route-state.js";

type AppShellFrameInput = Parameters<typeof resolveAppShellFrame>[0];
type AppShellRouteState = ReturnType<typeof resolveAppShellRouteState>;

export function createAppShellFrameInput(input: {
  routeState: AppShellRouteState;
  locationPathname: string;
  pageMeta?: AppPageMeta;
  overrides?: Partial<AppShellFrameInput>;
}): AppShellFrameInput {
  return {
    handleBackToApp: () => {},
    handleNavigateToSettings: () => {},
    handleSignOut: () => {},
    handleSwitchOrganization: () => {},
    inAutomations: input.routeState.inAutomations,
    inDashboardRoot: input.routeState.inDashboardRoot,
    inSandboxProfiles: input.routeState.inSandboxProfiles,
    inSessionDetail: input.routeState.inSessionDetail,
    inSessions: input.routeState.inSessions,
    inSettings: input.routeState.inSettings,
    isSigningOut: false,
    isSwitchingOrganization: false,
    locationPathname: input.locationPathname,
    organizationOptions: [{ id: "org_123", name: "Mistle Labs" }],
    organizationErrorMessage: null,
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
