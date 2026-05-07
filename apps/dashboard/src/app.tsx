import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  useLocation,
} from "react-router";

import { APP_SHELL_ROUTE_MANIFEST } from "./app-route-manifest.js";
import type { AppRouteElementKey, AppRouteManifestEntry } from "./app-route-manifest.js";
import { AuthLoginCallbackPage } from "./features/auth/auth-login-callback-page.js";
import { AuthScreen } from "./features/auth/auth-screen.js";
import {
  AUTH_SWITCH_ORGANIZATION_PATH,
  AuthSwitchOrganizationPage,
} from "./features/auth/auth-switch-organization-page.js";
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
        {renderAppRoutes(APP_SHELL_ROUTE_MANIFEST)}
      </Route>
    </Route>
    <Route element={<Navigate replace to="/" />} path="*" />
  </>,
);

const appRouter = createBrowserRouter(APP_ROUTES);

function RouteOutlet(): React.JSX.Element {
  return <Outlet />;
}

function renderAppRoutes(routes: readonly AppRouteManifestEntry[]): React.JSX.Element[] {
  return routes.map(renderAppRoute);
}

function renderAppRoute(route: AppRouteManifestEntry): React.JSX.Element {
  const children =
    route.children === undefined || route.children.length === 0
      ? undefined
      : renderAppRoutes(route.children);
  const element = renderAppRouteElement(route.element);
  const key = resolveAppRouteKey(route);

  if (route.index === true) {
    return <Route element={element} handle={route.handle} index key={key} />;
  }

  return (
    <Route element={element} handle={route.handle} key={key} path={route.path}>
      {children}
    </Route>
  );
}

function resolveAppRouteKey(route: AppRouteManifestEntry): string {
  if (route.index === true) {
    return `${route.element}:index`;
  }

  return `${route.element}:${route.path ?? ""}`;
}

function renderAppRouteElement(element: AppRouteElementKey): React.JSX.Element {
  switch (element) {
    case "automationCreate":
      return <AutomationCreatePage />;
    case "automations":
      return <AutomationsPage />;
    case "home":
      return <HomePage />;
    case "integrationConnectionCreate":
      return <IntegrationConnectionCreatePage />;
    case "integrationConnectionEdit":
      return <IntegrationConnectionEditPage />;
    case "integrationConnectionSetup":
      return <IntegrationConnectionSetupPage />;
    case "legacyOrganizationIntegrationsRedirect":
      return <LegacyOrganizationIntegrationsRedirect />;
    case "newSession":
      return <NewSessionPage />;
    case "organizationGeneralSettings":
      return <OrganizationGeneralSettingsPage />;
    case "organizationIdentityLinkingSettings":
      return <OrganizationIdentityLinkingSettingsPage />;
    case "organizationIntegrationsSettings":
      return <OrganizationIntegrationsSettingsPage />;
    case "organizationMembersSettings":
      return <OrganizationMembersSettingsPage />;
    case "organizationSandboxStorageSettings":
      return <OrganizationSandboxStorageSettingsPage />;
    case "profileSettings":
      return <ProfileSettingsPage />;
    case "routeOutlet":
      return <RouteOutlet />;
    case "sandboxProfileDefaultRedirect":
      return <SandboxProfileDefaultRedirect />;
    case "sandboxProfileEditorCreate":
      return <SandboxProfileEditorPage mode="create" />;
    case "sandboxProfileEditorEdit":
      return <SandboxProfileEditorPage mode="edit" />;
    case "sandboxProfileEditorShell":
      return <SandboxProfileEditorShell />;
    case "sandboxProfiles":
      return <SandboxProfilesPage />;
    case "scheduledAutomationCreateRedirect":
      return <Navigate replace to="/automations/new?type=scheduled" />;
    case "scheduledAutomationEditorEdit":
      return <ScheduledAutomationEditorPage mode="edit" />;
    case "sessionWorkbench":
      return <SessionWorkbenchPage />;
    case "sessions":
      return <SessionsPage />;
    case "settingsDefaultRedirect":
      return <Navigate replace to={SETTINGS_DEFAULT_PATH} />;
    case "settingsOrganizationGeneralRedirect":
      return <Navigate replace to="/settings/organization/general" />;
    case "webhookAutomationEditorEdit":
      return <WebhookAutomationEditorPage mode="edit" />;
  }
}

function LegacyOrganizationIntegrationsRedirect(): React.JSX.Element {
  const location = useLocation();
  const legacyPrefix = "/settings/organization/integrations";
  const pathname = location.pathname.startsWith(legacyPrefix)
    ? `/integrations${location.pathname.slice(legacyPrefix.length)}`
    : "/integrations";

  return (
    <Navigate
      replace
      to={{
        pathname,
        search: location.search,
        hash: location.hash,
      }}
    />
  );
}
