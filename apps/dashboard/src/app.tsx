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
import { AutomationCreatePage } from "./features/pages/automation-create-page.js";
import { AutomationsPage } from "./features/pages/automations-page.js";
import { HomePage } from "./features/pages/home-page.js";
import { IntegrationConnectionCreatePage } from "./features/pages/integration-connection-create-page.js";
import { IntegrationConnectionEditPage } from "./features/pages/integration-connection-edit-page.js";
import { IntegrationConnectionSetupPage } from "./features/pages/integration-connection-setup-page.js";
import { InvitationAcceptPage } from "./features/pages/invitation-accept-page.js";
import { NewSessionPage } from "./features/pages/new-session-page.js";
import { OrganizationGeneralSettingsPage } from "./features/pages/organization-general-settings-page.js";
import { OrganizationIdentityLinkingSettingsPage } from "./features/pages/organization-identity-linking-settings-page.js";
import { OrganizationIntegrationsSettingsPage } from "./features/pages/organization-integrations-settings-page.js";
import { OrganizationMembersSettingsPage } from "./features/pages/organization-members-settings-page.js";
import { OrganizationSandboxStorageSettingsPage } from "./features/pages/organization-sandbox-storage-settings-page.js";
import { ProfileSettingsPage } from "./features/pages/profile-settings-page.js";
import {
  SandboxProfileDefaultRedirect,
  SandboxProfileEditorPage,
  SandboxProfileEditorShell,
} from "./features/pages/sandbox-profile-editor-page.js";
import { SandboxProfilesPage } from "./features/pages/sandbox-profiles-page.js";
import { ScheduledAutomationEditorPage } from "./features/pages/scheduled-automation-editor-page.js";
import { SessionWorkbenchPage } from "./features/pages/session-workbench-page.js";
import { SessionsPage } from "./features/pages/sessions-page.js";
import { WebhookAutomationEditorPage } from "./features/pages/webhook-automation-editor-page.js";
import { SETTINGS_DEFAULT_PATH } from "./features/settings/model.js";
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
            element={<SandboxProfileEditorShell />}
            handle={ROUTE_HANDLES.sandboxProfilesDetail}
            path=":profileId"
          >
            <Route element={<SandboxProfileDefaultRedirect />} index />
            <Route element={<SandboxProfileEditorPage mode="edit" />}>
              <Route handle={ROUTE_HANDLES.sandboxProfileEditor} path="sandbox-profile">
                <Route element={<RouteOutlet />} index />
                <Route
                  element={<RouteOutlet />}
                  handle={ROUTE_HANDLES.sandboxProfileDraft}
                  path="draft"
                />
                <Route
                  element={<RouteOutlet />}
                  handle={ROUTE_HANDLES.sandboxProfilePublished}
                  path="published"
                />
              </Route>
              <Route
                element={<RouteOutlet />}
                handle={ROUTE_HANDLES.sandboxProfileSnapshots}
                path="snapshots"
              />
            </Route>
          </Route>
        </Route>
        <Route element={<RouteOutlet />} handle={ROUTE_HANDLES.automations} path="automations">
          <Route element={<AutomationsPage />} index />
          <Route
            element={<AutomationCreatePage />}
            handle={ROUTE_HANDLES.automationsNew}
            path="new"
          />
          <Route
            element={<Navigate replace to="/automations/new?type=scheduled" />}
            path="schedules/new"
          />
          <Route
            element={<ScheduledAutomationEditorPage mode="edit" />}
            handle={ROUTE_HANDLES.scheduledAutomationsDetail}
            path="schedules/:automationId"
          />
          <Route
            element={<WebhookAutomationEditorPage mode="edit" />}
            handle={ROUTE_HANDLES.automationsDetail}
            path=":automationId"
          />
        </Route>
        <Route element={<RouteOutlet />} handle={ROUTE_HANDLES.integrations} path="integrations">
          <Route element={<OrganizationIntegrationsSettingsPage />} index />
          <Route handle={ROUTE_HANDLES.integrationDetail} path=":targetKey">
            <Route element={<OrganizationIntegrationsSettingsPage />} index />
            <Route
              element={<IntegrationConnectionCreatePage />}
              handle={ROUTE_HANDLES.integrationCreate}
              path="add"
            />
            <Route
              element={<IntegrationConnectionEditPage />}
              handle={ROUTE_HANDLES.integrationEdit}
              path=":connectionId/edit"
            />
            <Route
              element={<IntegrationConnectionSetupPage />}
              handle={ROUTE_HANDLES.integrationSetup}
              path=":connectionId/:setupRouteSegment/setup"
            />
          </Route>
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
        <Route element={<RouteOutlet />} handle={ROUTE_HANDLES.settings} path="settings">
          <Route element={<Navigate replace to={SETTINGS_DEFAULT_PATH} />} index />
          <Route element={<RouteOutlet />} handle={ROUTE_HANDLES.settingsAccount} path="account">
            <Route element={<Navigate replace to={SETTINGS_DEFAULT_PATH} />} index />
            <Route
              element={<ProfileSettingsPage />}
              handle={ROUTE_HANDLES.settingsProfile}
              path="profile"
            />
          </Route>
          <Route
            element={<RouteOutlet />}
            handle={ROUTE_HANDLES.settingsOrganization}
            path="organization"
          >
            <Route element={<Navigate replace to="/settings/organization/general" />} index />
            <Route
              element={<OrganizationGeneralSettingsPage />}
              handle={ROUTE_HANDLES.settingsOrganizationGeneral}
              path="general"
            />
            <Route
              element={<OrganizationMembersSettingsPage />}
              handle={ROUTE_HANDLES.settingsOrganizationMembers}
              path="members"
            />
            <Route
              element={<OrganizationIdentityLinkingSettingsPage />}
              handle={ROUTE_HANDLES.settingsOrganizationIdentityLinking}
              path="identity-linking"
            />
            <Route
              element={<OrganizationSandboxStorageSettingsPage />}
              handle={ROUTE_HANDLES.settingsOrganizationSandboxes}
              path="sandboxes"
            />
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
