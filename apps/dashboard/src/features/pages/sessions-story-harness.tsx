import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";

import { AppBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { SandboxInstancesListResult } from "../sessions/sessions-types.js";
import { resolveAppShellFrame } from "../shell/app-shell-frame.js";
import { AppShellHeaderActionsContext } from "../shell/app-shell-header-actions.js";
import { resolveAppShellRouteState } from "../shell/app-shell-route-state.js";
import {
  resolveSidebarModeEnableNavigationTarget,
  SessionsRoutes,
} from "../shell/app-shell-sessions-sidebar-mode.js";
import { AppShellView } from "../shell/app-shell-view.js";
import { NewSessionPage } from "./new-session-page.js";
import { SessionsPage } from "./sessions-page.js";
import { createSessionsPageStoryQueryClient } from "./sessions-page.story-fixtures.js";

type SessionsStoryHarnessProps = {
  initialEntries: readonly string[];
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
  sandboxInstancesList?: SandboxInstancesListResult;
  sessionsSidebarQueryState?:
    | {
        kind: "success";
      }
    | {
        kind: "pending";
      }
    | {
        errorMessage?: string;
        kind: "error";
      };
  showSessionsSidebar?: boolean;
};

export function SessionsStoryHarness(input: SessionsStoryHarnessProps): React.JSX.Element {
  const [queryClient] = useState(() =>
    createSessionsPageStoryQueryClient({
      ...(input.launchableProfiles !== undefined
        ? { launchableProfiles: input.launchableProfiles }
        : {}),
      ...(input.sandboxInstancesList !== undefined
        ? { sandboxInstancesList: input.sandboxInstancesList }
        : {}),
      ...(input.sessionsSidebarQueryState !== undefined
        ? { sessionsSidebarQueryState: input.sessionsSidebarQueryState }
        : {}),
    }),
  );
  const [router] = useState(() =>
    createMemoryRouter(
      createRoutesFromElements(
        <Route
          element={
            <SessionsStoryShell
              {...(input.showSessionsSidebar !== undefined
                ? { initialShowSessionsSidebar: input.showSessionsSidebar }
                : {})}
            />
          }
        >
          <Route element={<StoryRouteOutlet />} handle={ROUTE_HANDLES.sessions} path="/sessions">
            <Route element={<SessionsPage />} index />
            <Route element={<NewSessionPage />} handle={ROUTE_HANDLES.sessionsNew} path="new" />
            <Route
              element={<SessionDetailStoryPage />}
              handle={ROUTE_HANDLES.sessionsDetail}
              path=":sandboxInstanceId"
            />
          </Route>
        </Route>,
      ),
      {
        initialEntries: [...input.initialEntries],
      },
    ),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function SessionsStoryShell(input: { initialShowSessionsSidebar?: boolean }): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const [headerActions, setHeaderActions] = useState<React.ReactNode | null>(null);
  const [showSessionsSidebar, setShowSessionsSidebar] = useState(
    input.initialShowSessionsSidebar === true,
  );
  const routeState = resolveAppShellRouteState(location.pathname);
  const appShellFrame = resolveAppShellFrame({
    handleBackToApp: () => {},
    handleNavigateToSettings: () => {},
    handleSignOut: () => {},
    inAutomations: routeState.inAutomations,
    inDashboardRoot: routeState.inDashboardRoot,
    inSandboxProfiles: routeState.inSandboxProfiles,
    inSessionDetail: routeState.inSessionDetail,
    inSessions: routeState.inSessions,
    inSettings: routeState.inSettings,
    isSigningOut: false,
    locationPathname: location.pathname,
    organizationErrorMessage: null,
    organizationImageUrl: null,
    organizationName: "Mistle Labs",
    pageMeta: {
      appShellInsetOwner: location.pathname === SessionsRoutes.NEW ? "child" : "app-shell",
      appShellViewportMode: "document",
      title: null,
      headerIcon: null,
      supportingText: null,
    },
    signOutError: null,
    showSessionsSidebar,
    onShowSessionsSidebarChange: (checked) => {
      setShowSessionsSidebar(checked);

      if (!checked) {
        return;
      }

      const navigationTarget = resolveSidebarModeEnableNavigationTarget(location.pathname);

      if (navigationTarget !== null) {
        void navigate(navigationTarget);
      }
    },
  });

  return (
    <AppShellHeaderActionsContext.Provider value={setHeaderActions}>
      <AppShellView
        {...appShellFrame}
        breadcrumbs={<AppBreadcrumbs />}
        headerActions={headerActions}
        mainContent={<Outlet />}
      />
    </AppShellHeaderActionsContext.Provider>
  );
}

function StoryRouteOutlet(): React.JSX.Element {
  return <Outlet />;
}

function SessionDetailStoryPage(): React.JSX.Element {
  const params = useParams<{ sandboxInstanceId: string }>();
  const sandboxInstanceId = params.sandboxInstanceId ?? "unknown-session";

  return (
    <div className="flex min-h-full flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-2xl rounded-xl border bg-card p-8 shadow-xs">
          <p className="text-muted-foreground text-sm uppercase tracking-[0.18em]">
            Storybook session detail
          </p>
          <h1 className="mt-3 font-semibold text-2xl">Session detail preview</h1>
          <p className="mt-3 text-muted-foreground text-sm">
            Storybook routes sidebar session links to this placeholder instead of the full session
            workbench.
          </p>
          <div className="mt-6 rounded-lg border bg-muted/40 px-4 py-3 font-mono text-sm">
            {sandboxInstanceId}
          </div>
        </div>
      </div>
    </div>
  );
}
