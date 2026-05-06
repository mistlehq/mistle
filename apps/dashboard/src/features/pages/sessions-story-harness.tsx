import { QueryClientProvider } from "@tanstack/react-query";
import { useRef, useState } from "react";
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

import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { SandboxInstancesListResult } from "../sessions/sessions-types.js";
import { resolveAppShellFrame } from "../shell/app-shell-frame.js";
import { resolveAppShellRouteState } from "../shell/app-shell-route-state.js";
import {
  isExistingSandboxSessionPath,
  resolveLocationHref,
  resolveSidebarModeDisableNavigationTarget,
  resolveSidebarModeEnableNavigationTarget,
  SessionsRoutes,
} from "../shell/app-shell-sessions-sidebar-mode.js";
import { AppShellView } from "../shell/app-shell-view.js";
import { NewSessionPage } from "./new-session-page.js";
import { SessionWorkbenchPage } from "./session-workbench-page.js";
import { SessionsPage } from "./sessions-page.js";
import { createSessionsPageStoryQueryClient } from "./sessions-page.story-fixtures.js";

type SessionsStoryHarnessProps = {
  initialEntries: readonly string[];
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
  renderSessionWorkbenchPage?: boolean;
  sandboxInstanceStatus?: {
    id: string;
    title: string | null;
    status: "pending" | "starting" | "running" | "stopped" | "failed";
    connectable: boolean;
    runtimeContext?: {
      launchCwd: string | null;
      primaryRepositoryRoot: string | null;
    } | null;
    failureCode?: string | null;
    failureMessage?: string | null;
  };
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
      ...(input.sandboxInstanceStatus !== undefined
        ? { sandboxInstanceStatus: input.sandboxInstanceStatus }
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
          <Route
            element={<AutomationsStoryPage />}
            handle={ROUTE_HANDLES.automations}
            path="/automations"
          />
          <Route element={<Outlet />} handle={ROUTE_HANDLES.sessions} path="/sessions">
            <Route element={<SessionsPage />} index />
            <Route element={<NewSessionPage />} handle={ROUTE_HANDLES.sessionsNew} path="new" />
            <Route
              element={
                input.renderSessionWorkbenchPage === true ? (
                  <SessionWorkbenchPage />
                ) : (
                  <SessionDetailStoryPage />
                )
              }
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
  const previousSessionDetailUrlRef = useRef<string | null>(null);
  const previousSessionsSidebarToggleUrlRef = useRef<string | null>(null);
  const [showSessionsSidebar, setShowSessionsSidebar] = useState(
    input.initialShowSessionsSidebar === true,
  );
  const routeState = resolveAppShellRouteState(location.pathname);
  const appShellFrame = resolveAppShellFrame({
    handleBackToApp: () => {},
    handleNavigateToSettings: () => {},
    handleSignOut: () => {},
    handleSwitchOrganization: () => {},
    inAutomations: routeState.inAutomations,
    inDashboardRoot: routeState.inDashboardRoot,
    inIntegrations: routeState.inIntegrations,
    inSandboxProfiles: routeState.inSandboxProfiles,
    inSessionDetail: routeState.inSessionDetail,
    inSessions: routeState.inSessions,
    inSettings: routeState.inSettings,
    isSigningOut: false,
    isSwitchingOrganization: false,
    locationPathname: location.pathname,
    organizationOptions: [{ id: "org_123", name: "Mistle Labs" }],
    organizationSummaryErrorMessage: null,
    organizationSwitcherErrorMessage: null,
    organizationImageUrl: null,
    activeOrganizationId: "org_123",
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
      const currentLocationHref = resolveLocationHref({
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      });

      setShowSessionsSidebar(checked);

      if (!checked) {
        if (isExistingSandboxSessionPath(location.pathname)) {
          previousSessionDetailUrlRef.current = currentLocationHref;
        }

        const navigationTarget = resolveSidebarModeDisableNavigationTarget({
          currentLocationHref,
          currentPathname: location.pathname,
          previousLocationHref: previousSessionsSidebarToggleUrlRef.current,
        });
        previousSessionsSidebarToggleUrlRef.current = null;

        if (navigationTarget !== null) {
          void navigate(navigationTarget);
        }

        return;
      }

      previousSessionsSidebarToggleUrlRef.current = currentLocationHref;

      const navigationTarget = resolveSidebarModeEnableNavigationTarget({
        lastInteractedSessionHref: previousSessionDetailUrlRef.current,
        pathname: location.pathname,
      });

      if (navigationTarget !== null) {
        void navigate(navigationTarget);
      }
    },
  });

  return <AppShellView {...appShellFrame} mainContent={<Outlet />} />;
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

function AutomationsStoryPage(): React.JSX.Element {
  return (
    <div className="flex min-h-full flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-2xl rounded-xl border bg-card p-8 shadow-xs">
          <p className="text-muted-foreground text-sm uppercase tracking-[0.18em]">
            Storybook route
          </p>
          <h1 className="mt-3 font-semibold text-2xl">Automations preview</h1>
          <p className="mt-3 text-muted-foreground text-sm">
            Toggle sessions mode on from this route to verify Storybook follows the same
            sessions-entry and return navigation behavior as the app shell.
          </p>
        </div>
      </div>
    </div>
  );
}
