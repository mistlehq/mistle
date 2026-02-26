import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";

import { AuthScreen } from "./features/auth/auth-screen.js";
import { ROUTE_HANDLES } from "./features/navigation/route-handles.js";
import { DummyPage } from "./features/pages/dummy-page.js";
import { PagePlaceholder } from "./features/pages/page-placeholder.js";
import { AppShell } from "./features/shell/app-shell.js";
import { RequireAuth } from "./features/shell/require-auth.js";
import { RouteErrorBoundary } from "./features/shell/route-error-boundary.js";

export function App(): React.JSX.Element {
  return <RouterProvider router={appRouter} />;
}

export const APP_ROUTES = createRoutesFromElements(
  <>
    <Route element={<AuthScreen />} errorElement={<RouteErrorBoundary />} path="/auth/login" />
    <Route element={<RequireAuth />} errorElement={<RouteErrorBoundary />}>
      <Route element={<AppShell />} errorElement={<RouteErrorBoundary />}>
        <Route
          element={<DummyPage />}
          errorElement={<RouteErrorBoundary />}
          handle={ROUTE_HANDLES.dashboard}
          index
        />
        <Route
          element={<RouteOutlet />}
          errorElement={<RouteErrorBoundary />}
          handle={ROUTE_HANDLES.sandboxProfiles}
          path="sandbox-profiles"
        >
          <Route
            element={
              <PagePlaceholder
                description="Browse and manage sandbox profiles."
                title="Sandbox profiles"
              />
            }
            index
          />
          <Route
            element={
              <PagePlaceholder
                description="Create a new sandbox profile."
                title="Create sandbox profile"
              />
            }
            handle={ROUTE_HANDLES.sandboxProfilesNew}
            path="new"
          />
          <Route
            element={
              <PagePlaceholder
                description="Edit sandbox profile configuration."
                title="Edit sandbox profile"
              />
            }
            handle={ROUTE_HANDLES.sandboxProfilesDetail}
            loader={({ params }) => {
              const profileId = params["profileId"];
              if (profileId === undefined) {
                throw new Error("profileId is required.");
              }

              return {
                displayName: profileId,
              };
            }}
            path=":profileId"
          />
        </Route>
        <Route
          element={<PagePlaceholder description="Review session activity." title="Sessions" />}
          errorElement={<RouteErrorBoundary />}
          handle={ROUTE_HANDLES.sessions}
          path="sessions"
        />
        <Route
          element={<RouteOutlet />}
          errorElement={<RouteErrorBoundary />}
          handle={ROUTE_HANDLES.settings}
          path="settings"
        >
          <Route
            element={<RouteOutlet />}
            errorElement={<RouteErrorBoundary />}
            handle={ROUTE_HANDLES.settingsAccount}
            path="account"
          >
            <Route
              element={
                <PagePlaceholder
                  description="Manage your personal profile settings."
                  title="Profile"
                />
              }
              errorElement={<RouteErrorBoundary />}
              handle={ROUTE_HANDLES.settingsProfile}
              path="profile"
            />
          </Route>
          <Route
            element={<RouteOutlet />}
            errorElement={<RouteErrorBoundary />}
            handle={ROUTE_HANDLES.settingsOrganization}
            path="organization"
          >
            <Route
              element={
                <PagePlaceholder
                  description="Manage organization details and naming."
                  title="General"
                />
              }
              errorElement={<RouteErrorBoundary />}
              handle={ROUTE_HANDLES.settingsOrganizationGeneral}
              path="general"
            />
            <Route
              element={
                <PagePlaceholder description="Manage organization membership." title="Members" />
              }
              errorElement={<RouteErrorBoundary />}
              handle={ROUTE_HANDLES.settingsOrganizationMembers}
              path="members"
            />
            <Route
              element={<RouteOutlet />}
              errorElement={<RouteErrorBoundary />}
              handle={ROUTE_HANDLES.settingsOrganizationProviders}
              path="providers"
            >
              <Route
                element={
                  <PagePlaceholder
                    description="Manage provider connections for this organization."
                    title="Providers"
                  />
                }
                errorElement={<RouteErrorBoundary />}
                index
              />
              <Route
                element={
                  <PagePlaceholder
                    description="Review provider callback results."
                    title="Provider callback result"
                  />
                }
                errorElement={<RouteErrorBoundary />}
                handle={ROUTE_HANDLES.settingsOrganizationProviderCallbackResult}
                path=":providerId/callback-result"
              />
            </Route>
          </Route>
        </Route>
      </Route>
    </Route>
    <Route element={<Navigate replace to="/" />} path="*" />
  </>,
);

const appRouter = createBrowserRouter(APP_ROUTES);

function RouteOutlet(): React.JSX.Element {
  return <Outlet />;
}
