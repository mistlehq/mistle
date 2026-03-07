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
import { CodexSessionPage } from "./features/pages/codex-session-page.js";
import { HomePage } from "./features/pages/home-page.js";
import { IntegrationsCallbackResultPage } from "./features/pages/integrations-callback-result-page.js";
import { InvitationAcceptPage } from "./features/pages/invitation-accept-page.js";
import { OrganizationGeneralSettingsPage } from "./features/pages/organization-general-settings-page.js";
import { OrganizationIntegrationsSettingsPage } from "./features/pages/organization-integrations-settings-page.js";
import { OrganizationMembersSettingsPage } from "./features/pages/organization-members-settings-page.js";
import { ProfileSettingsPage } from "./features/pages/profile-settings-page.js";
import { SandboxProfileEditorPage } from "./features/pages/sandbox-profile-editor-page.js";
import { SandboxProfilesPage } from "./features/pages/sandbox-profiles-page.js";
import { SessionsPage } from "./features/pages/sessions-page.js";
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
        <Route element={<HomePage />} handle={ROUTE_HANDLES.dashboard} index />
        <Route
          element={<RouteOutlet />}
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
            path=":profileId"
          />
        </Route>
        <Route element={<RouteOutlet />} handle={ROUTE_HANDLES.sessions} path="sessions">
          <Route element={<SessionsPage />} index />
          <Route
            element={<CodexSessionPage />}
            handle={ROUTE_HANDLES.sessionsDetail}
            path=":sandboxInstanceId"
          />
        </Route>
        {createSettingsRoutes({
          settingsRoot: <SettingsLayout />,
          personal: <ProfileSettingsPage />,
          organizationGeneral: <OrganizationGeneralSettingsPage />,
          organizationMembers: <OrganizationMembersSettingsPage />,
          organizationIntegrations: <OrganizationIntegrationsSettingsPage />,
          organizationIntegrationCallbackResult: <IntegrationsCallbackResultPage />,
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
