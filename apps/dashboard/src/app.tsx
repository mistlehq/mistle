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
import { InvitationAcceptPage } from "./features/pages/invitation-accept-page.js";
import { OrganizationGeneralSettingsPage } from "./features/pages/organization-general-settings-page.js";
import { OrganizationMembersSettingsPage } from "./features/pages/organization-members-settings-page.js";
import { OrganizationProvidersSettingsPage } from "./features/pages/organization-providers-settings-page.js";
import { ProfileSettingsPage } from "./features/pages/profile-settings-page.js";
import { ProvidersCallbackResultPage } from "./features/pages/providers-callback-result-page.js";
import { SandboxProfileEditorPage } from "./features/pages/sandbox-profile-editor-page.js";
import { SandboxProfilesPage } from "./features/pages/sandbox-profiles-page.js";
import { SessionsPage } from "./features/pages/sessions-page.js";
import { resolveScaffoldProfileDisplayName } from "./features/sandbox-profiles/scaffold-profiles.js";
import { SettingsLayout } from "./features/settings/settings-layout.js";
import { createSettingsRoutes } from "./features/settings/settings-routes.js";
import { AppShell } from "./features/shell/app-shell.js";
import { RequireAuth } from "./features/shell/require-auth.js";
import { RouteErrorBoundary } from "./features/shell/route-error-boundary.js";

export function App(): React.JSX.Element {
  return <RouterProvider router={appRouter} />;
}

export const APP_ROUTES = createRoutesFromElements(
  <>
    <Route element={<AuthScreen />} errorElement={<RouteErrorBoundary />} path="/auth/login" />
    <Route
      element={<InvitationAcceptPage />}
      errorElement={<RouteErrorBoundary />}
      path="/invitations/accept"
    />
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
                displayName: resolveScaffoldProfileDisplayName(profileId) ?? profileId,
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
        {createSettingsRoutes({
          settingsRoot: <SettingsLayout />,
          profile: <ProfileSettingsPage />,
          organizationGeneral: <OrganizationGeneralSettingsPage />,
          organizationMembers: <OrganizationMembersSettingsPage />,
          organizationProviders: <OrganizationProvidersSettingsPage />,
          organizationProviderCallbackResult: <ProvidersCallbackResultPage />,
          errorElement: <RouteErrorBoundary />,
        })}
      </Route>
    </Route>
    <Route element={<Navigate replace to="/" />} path="*" />
  </>,
);

const appRouter = createBrowserRouter(APP_ROUTES);

function RouteOutlet(): React.JSX.Element {
  return <Outlet />;
}
