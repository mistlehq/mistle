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
import { HomePage } from "./features/pages/home-page.js";
import { OrganizationGeneralSettingsPage } from "./features/pages/organization-general-settings-page.js";
import { OrganizationMembersSettingsPage } from "./features/pages/organization-members-settings-page.js";
import { OrganizationProvidersSettingsPage } from "./features/pages/organization-providers-settings-page.js";
import { ProfileSettingsPage } from "./features/pages/profile-settings-page.js";
import { ProvidersCallbackResultPage } from "./features/pages/providers-callback-result-page.js";
import { SandboxProfileEditorPage } from "./features/pages/sandbox-profile-editor-page.js";
import { SandboxProfilesPage } from "./features/pages/sandbox-profiles-page.js";
import { SessionsPage } from "./features/pages/sessions-page.js";
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
          element={<HomePage />}
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
          <Route element={<SandboxProfilesPage />} index />
          <Route
            element={<SandboxProfileEditorPage mode="create" />}
            handle={ROUTE_HANDLES.sandboxProfilesNew}
            path="new"
          />
          <Route
            element={<SandboxProfileEditorPage mode="edit" />}
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
          element={<SessionsPage />}
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
              element={<ProfileSettingsPage />}
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
              element={<OrganizationGeneralSettingsPage />}
              errorElement={<RouteErrorBoundary />}
              handle={ROUTE_HANDLES.settingsOrganizationGeneral}
              path="general"
            />
            <Route
              element={<OrganizationMembersSettingsPage />}
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
                element={<OrganizationProvidersSettingsPage />}
                errorElement={<RouteErrorBoundary />}
                index
              />
              <Route
                element={<ProvidersCallbackResultPage />}
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
