import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";

import { SystemAppearanceProvider } from "./features/appearance/appearance-provider.js";
import { AuthLoginCallbackPage } from "./features/auth/auth-login-callback-page.js";
import { AuthScreen } from "./features/auth/auth-screen.js";
import {
  AUTH_SWITCH_ORGANIZATION_PATH,
  AuthSwitchOrganizationPage,
} from "./features/auth/auth-switch-organization-page.js";
import { ROUTE_HANDLES } from "./features/navigation/route-handles.js";
import { HomePage } from "./features/pages/home-page.js";
import { IntegrationConnectionCreatePage } from "./features/pages/integration-connection-create-page.js";
import { IntegrationConnectionEditPage } from "./features/pages/integration-connection-edit-page.js";
import { IntegrationConnectionSetupPage } from "./features/pages/integration-connection-setup-page.js";
import { InvitationAcceptPage } from "./features/pages/invitation-accept-page.js";
import { NewSessionPage } from "./features/pages/new-session-page.js";
import { OrganizationApiKeyCreatePage } from "./features/pages/organization-api-key-create-page.js";
import { OrganizationApiKeysSettingsPage } from "./features/pages/organization-api-keys-settings-page.js";
import { OrganizationBillingSettingsPage } from "./features/pages/organization-billing-settings-page.js";
import { OrganizationGeneralSettingsPage } from "./features/pages/organization-general-settings-page.js";
import { OrganizationIdentityLinkingSettingsPage } from "./features/pages/organization-identity-linking-settings-page.js";
import { OrganizationIntegrationsSettingsPage } from "./features/pages/organization-integrations-settings-page.js";
import { OrganizationMembersSettingsPage } from "./features/pages/organization-members-settings-page.js";
// import { OrganizationSandboxStorageSettingsPage } from "./features/pages/organization-sandbox-storage-settings-page.js";
import { ProfileSettingsPage } from "./features/pages/profile-settings-page.js";
import {
  SandboxProfileDefaultRedirect,
  SandboxProfileEditorPage,
  SandboxProfileEditorShell,
} from "./features/pages/sandbox-profile-editor-page.js";
import { SandboxProfilesPage } from "./features/pages/sandbox-profiles-page.js";
import { SessionWorkbenchPage } from "./features/pages/session-workbench-page.js";
import { SessionsPage } from "./features/pages/sessions-page.js";
import { TriggerCreatePage } from "./features/pages/trigger-create-page.js";
import { TriggerEditorPage } from "./features/pages/trigger-editor-page.js";
import { TriggersPage } from "./features/pages/triggers-page.js";
import { SETTINGS_DEFAULT_PATH } from "./features/settings/model.js";
import { AppShell } from "./features/shell/app-shell.js";
import { RequireAuth } from "./features/shell/require-auth.js";
import { RouteErrorBoundary } from "./features/shell/route-error-boundary.js";

export function App(): React.JSX.Element {
  return <RouterProvider router={getAppRouter()} />;
}

export const APP_ROUTES = createRoutesFromElements(
  <>
    <Route element={<SystemAppearanceRoute />} errorElement={<RouteErrorBoundary />}>
      <Route element={<AuthScreen />} path="/auth/login" />
      <Route element={<AuthLoginCallbackPage />} path="/auth/login/callback" />
      <Route element={<AuthSwitchOrganizationPage />} path={AUTH_SWITCH_ORGANIZATION_PATH} />
      <Route element={<InvitationAcceptPage />} path="/invitations/accept" />
    </Route>
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
                handle={ROUTE_HANDLES.sandboxProfileTriggers}
                path="triggers"
              >
                <Route element={<RouteOutlet />} index />
                <Route element={<RouteOutlet />} path=":triggerId" />
              </Route>
              <Route
                element={<RouteOutlet />}
                handle={ROUTE_HANDLES.sandboxProfileSnapshots}
                path="snapshots"
              />
            </Route>
          </Route>
        </Route>
        <Route element={<RouteOutlet />} handle={ROUTE_HANDLES.triggers} path="triggers">
          <Route element={<TriggersPage />} index />
          <Route element={<TriggerCreatePage />} handle={ROUTE_HANDLES.triggersNew} path="new" />
          <Route
            element={<TriggerEditorPage />}
            handle={ROUTE_HANDLES.triggersDetail}
            path=":triggerId"
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
            {/* <Route
                element={<OrganizationSandboxStorageSettingsPage />}
                handle={ROUTE_HANDLES.settingsOrganizationSandboxes}
                path="sandboxes"
              /> */}
            <Route
              element={<OrganizationBillingSettingsPage />}
              handle={ROUTE_HANDLES.settingsOrganizationBilling}
              path="billing"
            />
            <Route
              element={<RouteOutlet />}
              handle={ROUTE_HANDLES.settingsOrganizationApiKeys}
              path="api-keys"
            >
              <Route element={<OrganizationApiKeysSettingsPage />} index />
              <Route
                element={<OrganizationApiKeyCreatePage />}
                handle={ROUTE_HANDLES.settingsOrganizationApiKeysNew}
                path="new"
              />
            </Route>
          </Route>
        </Route>
      </Route>
    </Route>
    <Route element={<Navigate replace to="/" />} path="*" />
  </>,
);

let appRouter: ReturnType<typeof createBrowserRouter> | null = null;

function getAppRouter(): ReturnType<typeof createBrowserRouter> {
  appRouter ??= createBrowserRouter(APP_ROUTES);
  return appRouter;
}

function RouteOutlet(): React.JSX.Element {
  return <Outlet />;
}

function SystemAppearanceRoute(): React.JSX.Element {
  return (
    <SystemAppearanceProvider>
      <Outlet />
    </SystemAppearanceProvider>
  );
}
