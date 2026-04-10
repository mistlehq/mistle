import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";

import { AuthLoginCallbackPage } from "./features/auth/auth-login-callback-page.js";
import { AuthScreen } from "./features/auth/auth-screen.js";
import {
  AUTH_SWITCH_ORGANIZATION_PATH,
  AuthSwitchOrganizationPage,
} from "./features/auth/auth-switch-organization-page.js";
import { ROUTE_HANDLES } from "./features/navigation/route-handles.js";
import { AutomationsPage } from "./features/pages/automations-page.js";
import { HomePage } from "./features/pages/home-page.js";
import { IntegrationsCallbackResultPage } from "./features/pages/integrations-callback-result-page.js";
import { InvitationAcceptPage } from "./features/pages/invitation-accept-page.js";
import { NewSessionPage } from "./features/pages/new-session-page.js";
import { OrganizationGeneralSettingsPage } from "./features/pages/organization-general-settings-page.js";
import { OrganizationIntegrationsSettingsPage } from "./features/pages/organization-integrations-settings-page.js";
import { OrganizationMembersSettingsPage } from "./features/pages/organization-members-settings-page.js";
import { ProfileSettingsPage } from "./features/pages/profile-settings-page.js";
import { SandboxProfileEditorPage } from "./features/pages/sandbox-profile-editor-page.js";
import { SandboxProfilesPage } from "./features/pages/sandbox-profiles-page.js";
import { SessionWorkbenchPage } from "./features/pages/session-workbench-page.js";
import { SessionsPage } from "./features/pages/sessions-page.js";
import { WebhookAutomationEditorPage } from "./features/pages/webhook-automation-editor-page.js";
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
      element={<AuthLoginCallbackPage />}
      errorElement={<RouteErrorBoundary />}
      path="/auth/login/callback"
    />
    <Route
      element={<AuthSwitchOrganizationPage />}
      errorElement={<RouteErrorBoundary />}
      path={AUTH_SWITCH_ORGANIZATION_PATH}
    />
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
        <Route element={<RouteOutlet />} handle={ROUTE_HANDLES.automations} path="automations">
          <Route element={<AutomationsPage />} index />
          <Route
            element={<WebhookAutomationEditorPage mode="create" />}
            handle={ROUTE_HANDLES.automationsNew}
            path="new"
          />
          <Route
            element={<WebhookAutomationEditorPage mode="edit" />}
            handle={ROUTE_HANDLES.automationsDetail}
            path=":automationId"
          />
        </Route>
        <Route element={<RouteOutlet />} handle={ROUTE_HANDLES.integrations} path="integrations">
          <Route element={<OrganizationIntegrationsSettingsPage />} index />
          <Route
            element={<OrganizationIntegrationsSettingsPage />}
            handle={ROUTE_HANDLES.integrationDetail}
            path=":targetKey"
          />
          <Route
            element={<IntegrationsCallbackResultPage />}
            handle={ROUTE_HANDLES.integrationCallbackResult}
            path=":targetKey/callback-result"
          />
        </Route>
        <Route element={<RouteOutlet />} handle={ROUTE_HANDLES.sessions} path="sessions">
          <Route element={<SessionsPage />} index />
          <Route element={<NewSessionPage />} handle={ROUTE_HANDLES.sessionsNew} path="new" />
          <Route
            element={<SessionWorkbenchPage />}
            handle={ROUTE_HANDLES.sessionsDetail}
            path=":sandboxInstanceId"
          />
        </Route>
        {createSettingsRoutes({
          personal: <ProfileSettingsPage />,
          organizationGeneral: <OrganizationGeneralSettingsPage />,
          organizationMembers: <OrganizationMembersSettingsPage />,
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
